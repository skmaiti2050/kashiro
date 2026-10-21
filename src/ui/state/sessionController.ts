import { CheckSession } from '@/engine/session';
import type { ReviewDepth } from '@/engine/depth';
import type { Dictionary } from '@/engine/dictionary/lookup';
import type { RulesLinter } from '@/engine/linter';
import type { Rewriter } from '@/engine/llm/suggest';
import type { ModuleSwitches } from '@/engine/modules';
import type { PresetId } from '@/engine/presets';
import type { Variant } from '@/engine/types';
import { adapterFor as registryAdapterFor } from '@/formats/registry';
import type { FormatAdapter } from '@/formats/types';
import { afterAction } from './announce';
import { carryDecisions } from './carryDecisions';
import type { MessageKey } from '../i18n/catalogues';
import { msg, type Message } from '../i18n/message';
import { explain, plainError } from './errors';
import { checkOptions, currentDepth } from './checkOptions';
import { DecisionTally } from './decisionTally';
import { matchUnchangedParagraphs } from './documentText';
import { readDocument, readTypedText, type LoadedFile, type OpenDocument } from './openDocument';
import { progressOf } from './progress';
import { RecheckQueue } from './recheckQueue';
import { SAMPLE_NAME, SAMPLE_TEXT } from './sample';
import type { Files, OpenedFile } from './saveFlow';
import * as saveActions from './saveActions';
import { OptionalModules, type ModuleLoaders } from './optionalModules';
import { modulesFor, type Settings } from './settings';
import * as settingsActions from './settingsActions';

export type { Files, OpenedFile, SavedFile } from './saveFlow';
export { DOCX_NOTE, type OpenDocument } from './openDocument';

export interface ControllerDeps {
  files: Files;
  /** The settings loaded at start-up. */
  settings: Settings;
  saveSettings(settings: Settings): Promise<void>;
  /** The UI passes one built with harper.js/binary (the separate .wasm asset). */
  createLinter(variant: Variant, words: string[]): Promise<RulesLinter>;
  /** Defaults to the format registry; tests pass adapters that refuse edits. */
  adapterFor?: (fileName: string) => FormatAdapter | null;
  now?: () => Date;
  /** Loaders of the optional data and helper modules (see OptionalModules). */
  loadDictionary?: ModuleLoaders['loadDictionary'];
  startHelper?: ModuleLoaders['startHelper'];
}

export interface ControllerState {
  phase: 'empty' | 'checking' | 'ready';
  document: OpenDocument | null;
  session: CheckSession | null;
  settings: Settings;
  /** The variant the user picked for this document, or null to use the detected one. */
  variantOverride: Variant | null;
  /** Kept as messages, so they show in whatever language is active (see i18n/message.ts). */
  notice: Message | null;
  error: Message | null;
  /** Typed text waits for its re-check, or a re-check is running (the status bar's "Checking…"). */
  checking: boolean;
  /** Decisions the user made since the document was opened (the progress header's "of M"). */
  decided: number;
  /** Kinds dismissed with "This rule in this document": dropped when another document is opened. */
  documentIgnoredRules: string[];
  /** What the screen reader says after a decision ("Accepted. 4 of 9 left."); `seq` is new each time. */
  announcement: Announcement | null;
  /** Bumped on every change: the session is mutable, so views re-read it when this moves. */
  revision: number;
}

export interface Announcement {
  message: Message;
  seq: number;
}

const RECHECK_DELAY_MS = 300;
const PASTED_NAME = 'Untitled.txt';

/**
 * The desktop flow without React: open → check → review → save. Holds one document and its
 * CheckSession, re-checks typed text after a pause (keeping decisions on unchanged paragraphs), and
 * keeps the personal dictionary and other settings in step with the session.
 */
export class SessionController {
  private state: ControllerState;
  private readonly listeners = new Set<() => void>();
  private readonly adapterFor: (fileName: string) => FormatAdapter | null;
  private readonly queue = new RecheckQueue(RECHECK_DELAY_MS, (text) => this.checkTypedText(text));
  private linter: Promise<RulesLinter> | null = null;
  private loaded: LoadedFile | null = null;
  private documents = 0;
  /** Checks started; a check whose number is no longer the latest drops its result. */
  private checks = 0;
  /** Edits applied, decisions made or text typed since the document was opened or last saved. */
  private unsaved = false;
  private readonly tally = new DecisionTally();
  private announcements = 0;
  private readonly settingsHost: settingsActions.SettingsHost = {
    state: () => this.state,
    set: (patch) => this.set(patch),
    storeSettings: (settings) => {
      this.set({ settings });
      this.deps
        .saveSettings(settings)
        .catch((e) => this.set({ error: explain(msg('error.settingsSave'), e, msg('error.settingsSaveNext')) }));
    },
    decisionMade: (patch) => {
      this.tally.made(1);
      this.set({ ...patch, decided: this.tally.decided });
    },
    markUnsaved: () => (this.unsaved = true),
    announce: (verb) => this.set({ announcement: this.announcement(verb) }),
    dropLinter: () => (this.linter = null),
    recheck: () => this.recheck(),
    modulesChanged: async () => {
      // With a document open, the check that follows releases what the switches turned off (see check).
      if (this.loaded) return this.recheck();
      this.releaseModules(modulesFor(this.state.settings));
    },
  };
  private readonly saveHost: saveActions.SaveHost;
  private readonly optional: OptionalModules;

  constructor(private readonly deps: ControllerDeps) {
    this.saveHost = {
      state: () => this.state,
      set: (patch) => this.set(patch),
      flush: () => this.queue.flush(),
      loaded: () => this.loaded,
      files: deps.files,
      markSaved: () => (this.unsaved = false),
    };
    this.adapterFor = deps.adapterFor ?? registryAdapterFor;
    this.optional = new OptionalModules({ loadDictionary: deps.loadDictionary, startHelper: deps.startHelper });
    this.state = {
      phase: 'empty',
      document: null,
      session: null,
      settings: deps.settings,
      variantOverride: null,
      notice: null,
      error: null,
      checking: false,
      decided: 0,
      documentIgnoredRules: [],
      announcement: null,
      revision: 0,
    };
  }

  getState = (): ControllerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Builds the linter ahead of the first check (the first build takes ~650 ms). */
  async warmUp(): Promise<void> {
    await this.getLinter();
  }

  /** Resolves once no check is running (a pending typing pause is not waited for). */
  settled(): Promise<void> {
    return this.queue.settled();
  }

  /**
   * True when opening another document or closing would lose something: an edit applied, a decision
   * made or text typed since the document was opened or saved. Auto-fixes alone don't count: they come
   * back on the next check.
   */
  hasUnsavedWork(): boolean {
    return this.unsaved;
  }

  // ---- opening -------------------------------------------------------------

  async open(): Promise<void> {
    const file = await this.deps.files.open();
    if (file) await this.openFile(file);
  }

  async openFile(file: OpenedFile): Promise<void> {
    const adapter = this.adapterFor(file.name);
    if (!adapter) {
      this.set({ error: msg('error.unsupported', { name: file.name }) });
      return;
    }
    await this.load(file.name, file.path, adapter, file.bytes);
  }

  /** Starts an untitled plain-text document (paste or type). */
  async openText(text: string): Promise<void> {
    await this.load(PASTED_NAME, null, this.adapterFor(PASTED_NAME)!, new TextEncoder().encode(text));
  }

  /** "Try a sample paragraph": a built-in text with one of each card, opened like pasted text. */
  async openSample(): Promise<void> {
    await this.load(SAMPLE_NAME, null, this.adapterFor(SAMPLE_NAME)!, new TextEncoder().encode(SAMPLE_TEXT));
  }

  private async load(name: string, path: string | null, adapter: FormatAdapter, bytes: Uint8Array): Promise<void> {
    this.queue.cancel();
    let read: { loaded: LoadedFile; document: OpenDocument };
    try {
      read = await readDocument(this.documents + 1, name, path, adapter, bytes);
    } catch (e) {
      this.set({ error: explain(msg('error.open', { name }), e, msg('error.openNext')) });
      return;
    }
    const { loaded, document } = read;
    this.documents = document.id;
    this.loaded = loaded;
    this.unsaved = false;
    this.tally.reset();
    this.set({
      phase: 'checking',
      document,
      session: null,
      variantOverride: null,
      notice: null,
      error: null,
      checking: true,
      decided: this.tally.decided,
      documentIgnoredRules: [],
      announcement: null,
    });
    await this.queue.track(this.check(false));
  }

  // ---- checking ------------------------------------------------------------

  /** Typing in the editor (the text read back with the document's line separator): re-checks after a 300 ms pause. */
  editText(text: string): void {
    if (!this.state.document?.editable) return;
    this.unsaved = true;
    this.queue.push(text);
    if (!this.state.checking) this.set({ checking: true });
  }

  private async checkTypedText(text: string): Promise<void> {
    const document = this.state.document;
    if (!document || !this.loaded) return;
    let read: { loaded: LoadedFile; document: OpenDocument };
    try {
      read = await readTypedText(this.loaded, document, text);
    } catch (e) {
      this.set({ error: explain(msg('error.typed'), e, msg('error.typedNext')), checking: this.queue.waiting });
      return;
    }
    this.loaded = read.loaded;
    this.set({ document: read.document });
    await this.check(true);
  }

  /** Re-checks the current document, keeping the decisions on paragraphs that did not change. */
  private recheck(): Promise<void> {
    if (!this.loaded) return Promise.resolve();
    this.set({ checking: true });
    return this.queue.track(this.check(true));
  }

  private async check(keepDecisions: boolean): Promise<void> {
    const loaded = this.loaded!;
    const run = ++this.checks;
    const before = keepDecisions ? this.state.session : null;
    try {
      const linter = await this.getLinter();
      const { settings, variantOverride, documentIgnoredRules } = this.state;
      const options = checkOptions(settings, variantOverride, documentIgnoredRules, loaded.adapter.language);
      const session = await CheckSession.start(loaded.paras, options, { linter, now: this.deps.now });
      if (run !== this.checks) return;
      // The depth may have moved while the check ran.
      session.setDepth(currentDepth(this.state.settings));
      if (before) this.tally.remap(carryDecisions(before, session, matchUnchangedParagraphs(before.paragraphs(), loaded.paras)));
      this.set({ phase: 'ready', session, checking: this.queue.waiting });
      // After every check, so a goal switch (whose own modules may differ) releases too.
      this.releaseModules(session.modules);
    } catch (e) {
      if (run !== this.checks) return;
      const error = explain(msg('error.check'), e, msg('error.checkNext'));
      this.set({ phase: this.state.session ? 'ready' : 'empty', error, checking: this.queue.waiting });
    }
  }

  private getLinter(): Promise<RulesLinter> {
    const { fallbackVariant, dictionary } = this.state.settings;
    this.linter ??= this.deps.createLinter(fallbackVariant, [...dictionary]);
    return this.linter;
  }

  // ---- review --------------------------------------------------------------

  accept(decisionId: string, replacementIndex = 0): void {
    this.act((s) => s.accept(decisionId, replacementIndex), () => this.tally.made(1), 'verb.accepted');
  }

  reject(decisionId: string): void {
    this.rejectTogether(decisionId, (s) => s.reject(decisionId), 'verb.rejected');
  }

  ignoreAll(decisionId: string): void {
    this.rejectTogether(decisionId, (s) => s.ignoreAll(decisionId), 'verb.ignored');
  }

  /**
   * Rejects a decision as one: "Review again" on several of its places gives back one decision made, not one
   * each. A flag with nothing to apply is announced as dismissed, as its button says.
   */
  private rejectTogether(decisionId: string, change: (s: CheckSession) => void, verb: MessageKey): void {
    const session = this.state.session;
    if (!session) return;
    const { top, more } = session.decisions();
    const places = [...top, ...more].find((d) => d.id === decisionId)?.candidateIds ?? [decisionId];
    const replacements = new Map(session.candidates().map((c) => [c.id, c.replacements.length]));
    const flagOnly = places.every((id) => replacements.get(id) === 0);
    this.act(change, () => this.tally.rejected(decisionId, places), flagOnly ? 'verb.dismissed' : verb);
  }

  /** "Apply" after the batch preview: the chosen places as one change, undone together by undoBatch. */
  applyBatch(decisionId: string, candidateIds: string[], replacementIndex = 0): void {
    this.act((s) => s.applyBatch(decisionId, candidateIds, replacementIndex), () => this.tally.made(1), 'verb.applied');
  }

  undoBatch(batchId: string): void {
    this.act((s) => s.undoBatch(batchId), () => {}, 'verb.undone');
  }

  /**
   * Undo from the change log: applied → rejected, rejected → back to review. Back to review gives back one
   * decision made, once per rejection (a rejected batch's places come back one by one).
   */
  undo(candidateId: string): void {
    const status = this.state.session?.outcomes().find((o) => o.candidate.id === candidateId)?.status;
    this.act(
      (s) => s.undo(candidateId),
      () => {
        if (status === 'rejected') this.tally.reopen(candidateId);
      },
      status === 'rejected' ? 'verb.backToReview' : 'verb.undone',
    );
  }

  /** See settingsActions.ignoreRule. */
  ignoreRule(kind: string, scope: 'document' | 'everywhere'): void {
    settingsActions.ignoreRule(this.settingsHost, kind, scope);
  }

  /** Settings › Ignored rules › Restore. */
  restoreRule(kind: string): void {
    settingsActions.restoreRule(this.settingsHost, kind);
  }

  async addToDictionary(decisionId: string): Promise<void> {
    await settingsActions.addWords(this.settingsHost, (s) => s.addToDictionary(decisionId));
  }

  /** The names card: every name joins the dictionary except `keepAsTypos`, which become their own decisions. */
  async acceptNames(keepAsTypos: string[]): Promise<void> {
    await settingsActions.addWords(this.settingsHost, (s) => s.acceptNames(keepAsTypos));
  }

  /** The terms card: every term joins the dictionary except `keepAsTypos`, which become their own decisions. */
  async acceptTerms(keepAsTypos: string[]): Promise<void> {
    await settingsActions.addWords(this.settingsHost, (s) => s.acceptTerms(keepAsTypos));
  }

  /**
   * The words-in-other-languages card: every word joins the dictionary except `keepAsTypos` and the card's
   * likely typos, which join only when in `tickedLikelyTypos`.
   */
  async acceptOtherLanguage(keepAsTypos: string[], tickedLikelyTypos: string[] = []): Promise<void> {
    await settingsActions.addWords(this.settingsHost, (s) => s.acceptOtherLanguage(keepAsTypos, tickedLikelyTypos));
  }

  /** Review depth for `preset` (default: the current one), saved per preset; the current one applies at once. */
  setDepth(depth: ReviewDepth, preset: PresetId = this.state.settings.preset): void {
    settingsActions.setDepth(this.settingsHost, depth, preset);
  }

  setPreset(preset: PresetId): void {
    settingsActions.setPreset(this.settingsHost, preset);
  }

  /** null goes back to the detected variant. */
  setVariant(variant: Variant | null): void {
    settingsActions.setVariant(this.settingsHost, variant);
  }

  /** See settingsActions.changeSettings. */
  changeSettings(patch: settingsActions.SettingsPatch): void {
    settingsActions.changeSettings(this.settingsHost, patch);
  }

  async removeWord(word: string): Promise<void> {
    await settingsActions.removeWord(this.settingsHost, word);
  }

  /** See settingsActions.setModule. */
  setModule(name: keyof ModuleSwitches, on: boolean): void {
    settingsActions.setModule(this.settingsHost, name, on);
  }

  /** "Use different modules for this goal" (default: the current goal). */
  useModulesForPreset(on: boolean, preset: PresetId = this.state.settings.preset): void {
    settingsActions.useModulesForPreset(this.settingsHost, on, preset);
  }

  /** The offline dictionary, loaded on first use; null while word lookup is off. */
  dictionary(): Promise<Dictionary> | null {
    return this.optional.dictionary(modulesFor(this.state.settings));
  }

  /** The local writing helper, started on first use; null while AI rewrites are off. */
  helper(): Promise<Rewriter> | null {
    return this.optional.helper(modulesFor(this.state.settings));
  }

  private releaseModules(modules: ModuleSwitches): void {
    this.optional.release(modules).catch((e) => this.set({ error: explain(msg('error.helperStop'), e, msg('error.helperStopNext')) }));
  }

  /**
   * Runs a review action and, only once it succeeded, `count` (how it moves the tally of decisions made) and
   * the announcement "<verb>. N of M left.". A failure is shown, not thrown.
   */
  private act(change: (s: CheckSession) => void, count: () => void, verb: MessageKey): void {
    const session = this.state.session;
    if (!session) return;
    try {
      change(session);
    } catch (e) {
      this.set({ error: plainError(e) });
      return;
    }
    this.unsaved = true;
    count();
    this.set({ error: null, decided: this.tally.decided, announcement: this.announcement(msg(verb)) });
  }

  private announcement(verb: Message): Announcement | null {
    const session = this.state.session;
    if (!session) return null;
    return { message: afterAction(verb, progressOf(session, this.tally.decided)), seq: ++this.announcements };
  }

  // ---- saving --------------------------------------------------------------

  /** See saveActions.save. Resolves true when the file was written (false when cancelled or failed). */
  save(): Promise<boolean> {
    return saveActions.save(this.saveHost);
  }

  /** See saveActions.exportReport. */
  exportReport(): Promise<void> {
    return saveActions.exportReport(this.saveHost);
  }

  /** For failures outside the controller (a dropped file that can't be read, the linter not starting). */
  showError(error: Message): void {
    this.set({ error });
  }

  private set(patch: Partial<ControllerState>): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener();
  }
}
