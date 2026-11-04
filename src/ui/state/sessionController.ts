import { CheckSession } from '@/engine/session';
import { carryDecisions, userDecisions } from '@/engine/carryDecisions';
import type { ReviewDepth } from '@/engine/depth';
import type { LanguageEngine } from '@/engine/languageEngine';
import { createScriptEngines } from '@/engine/scriptEngines';
import type { Dictionary } from '@/engine/dictionary/lookup';
import { withTitleCaseLowered } from '@/engine/dictionaryWords';
import type { RulesLinter } from '@/engine/linter';
import type { Rewriter } from '@/engine/llm/suggest';
import type { ModuleSwitches } from '@/engine/modules';
import type { PresetId } from '@/engine/presets';
import type { Variant } from '@/engine/types';
import { adapterFor as registryAdapterFor } from '@/formats/registry';
import type { FormatAdapter } from '@/formats/types';
import { afterAction, withNotChecked } from './announce';
import type { MessageKey } from '../i18n/catalogues';
import { msg, type Message } from '../i18n/message';
import { UnreadableFileError } from '@/formats/fileProblems';
import { explain, openError, plainError } from './errors';
import { checkOptions, currentDepth } from './checkOptions';
import { DecisionTally } from './decisionTally';
import { matchParagraphs, sameParagraphs } from './documentText';
import { readDocument, readTypedText, type LoadedFile, type OpenDocument } from './openDocument';
import { proofreadingLabels } from '../proofreadingLabels';
import { progressOf } from './progress';
import { RecentProblems } from './recentProblems';
import { RecheckQueue } from './recheckQueue';
import { SAMPLE_NAME, SAMPLE_TEXT } from './sample';
import type { Files, OpenedFile } from './saveFlow';
import * as saveActions from './saveActions';
import { SessionPersistence, type PersistenceHost, type SavedReviewsState } from './sessionPersistence';
import { SessionStore, type SessionFiles } from './sessionStore';
import { OptionalModules, type HelperBackend, type ModuleLoaders } from './optionalModules';
import * as helperActions from './helperActions';
import { AiSuggestions } from './aiSuggestions';
import { NO_AI, type AiState } from './aiState';
import { modulesFor, type Settings } from './settings';
import * as settingsActions from './settingsActions';
import { yieldToBrowser } from './yieldToBrowser';
import { appliedInBatch, appliedOffer, rejectedOffer, type UndoOffer } from './undoOffer';

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
  /** The proofreading engines by Unicode script name; defaults to the registry (createScriptEngines). */
  scriptEngines?: ReadonlyMap<string, LanguageEngine>;
  /** Loaders of the optional data and helper modules (see OptionalModules). */
  loadDictionary?: ModuleLoaders['loadDictionary'];
  startHelper?: ModuleLoaders['startHelper'];
  stopHelper?: ModuleLoaders['stopHelper'];
  /** The writing helper's model file (Settings › Modules); without it no model can be chosen. */
  models?: ModelFiles;
  /**
   * False when the writing helper's files are not installed (the version without AI): Settings says so and AI
   * rewrites stay off whatever the saved switch says. Default true.
   */
  helperInstalled?: boolean;
  /** The saved-review files in the app's data folder; without them no review is saved. */
  sessions?: SessionFiles;
  /** Waits while the browser handles input between chunks of a long check (default yieldToBrowser). */
  yieldToBrowser?: () => Promise<void>;
  /**
   * Subscribes to the platform's storage loss (platform/settings.ts): the listener is called once, at once if the
   * browser already keeps nothing. The controller then shows notice.noStorage.
   */
  onStorageLost?: (listener: () => void) => void;
}

/** Thrown at a check's pause when a newer check has started: the old one stops there, its result unused. */
class CheckSuperseded extends Error {
  constructor() {
    super('a newer check replaced this one');
  }
}

/** Choosing the writing helper's model: the open dialog, and the chosen file's SHA-256. */
export interface ModelFiles {
  /** The .gguf file the user picked, or null when cancelled. */
  choose(): Promise<string | null>;
  hash(path: string): Promise<string>;
}

export interface ControllerState extends SavedReviewsState {
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
  /** The name of the file being read, until it is shown (the document area's "Opening…"). */
  opening: string | null;
  /** Decisions the user made since the document was opened (the progress header's "of M"). */
  decided: number;
  /** Kinds dismissed with "This rule in this document": dropped when another document is opened. */
  documentIgnoredRules: string[];
  /** What the screen reader says after a decision ("Accepted. 4 of 9 left."); `seq` is new each time. */
  announcement: Announcement | null;
  /** The undo toast after a big action, until the next change to the review (undoOffer.ts). */
  undoOffer: UndoOffer | null;
  /** A chosen model file is being hashed (a few seconds for gigabytes). */
  checkingModel: boolean;
  /** The build running the writing helper (Settings shows it), or null while none runs. */
  helperBackend: HelperBackend | null;
  /** The AI suggestions group: progress, its last notice, a suggestion to bring up. */
  ai: AiState;
  /** Bumped on every change: the session is mutable, so views re-read it when this moves. */
  revision: number;
  /**
   * Bumped on every change to the document's text, whatever made it: typing, or an edit applied or taken back in
   * place (a card, an AI suggestion, the change log). An open batch preview closes when it moves (useOpenPreview).
   */
  textChanges: number;
}

export interface Announcement {
  message: Message;
  seq: number;
}

const RECHECK_DELAY_MS = 300;
const PASTED_NAME = 'Untitled.txt';

/** The edits the session writes into the text, as one string: equal strings mean the same text. */
const editsOf = (session: CheckSession) => JSON.stringify(session.acceptedEdits());
const appliedIds = (session: CheckSession) => new Set(userDecisions(session).filter((d) => d.status === 'applied').map((d) => d.candidateId));

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
  /** Counts every edit applied, decision made or text typed in the open document. */
  private changes = 0;
  /** `changes` when the document was opened or last saved: anything after it is unsaved work. */
  private savedChanges = 0;
  /** Why the latest typed text was not read (too long to check, say); saving waits until it can be. */
  private typingRefused: Message | null = null;
  /** The error the last failed check showed; a check that works takes it down. */
  private checkFailure: Message | null = null;
  /** Fixes the user applied while a re-check was pending (#34): the next check says so for any it cannot carry. */
  private appliedWhileChecking = new Set<string>();
  private readonly tally = new DecisionTally();
  /** The last errors and notices shown, for ⋯ › Report a bug (F22 item 4); in memory only. */
  readonly problems = new RecentProblems();
  private announcements = 0;
  /** Undo toasts shown: each new one is a new `seq`, so its timer starts again. */
  private offers = 0;
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
      // Like any other change to the review: the toast's Undo would no longer match (Task F24, F23 review M-37).
      this.reviewChanged({ ...patch, decided: this.tally.decided });
      this.reviews.changed();
    },
    markUnsaved: () => this.changes++,
    announce: (verb) => this.set({ announcement: this.announcement(verb) }),
    dropLinter: () => {
      // A worker linter holds a Worker until disposed; a check still on it rejects, and is superseded by the recheck.
      void this.linter?.then(
        (linter) => linter.dispose?.(),
        () => {},
      );
      this.linter = null;
    },
    recheck: () => this.recheck(),
    modulesChanged: async () => {
      this.ai.modulesChanged(); // AI rewrites off: the run stops now, not after the re-check
      // With a document open, the check that follows releases what the switches turned off (see check).
      if (this.loaded) return this.recheck();
      this.releaseModules(modulesFor(this.state.settings));
    },
  };
  private readonly saveHost: saveActions.SaveHost;
  private readonly helperHost: helperActions.HelperHost;
  /** Saved review sessions: autosave, the resume prompt and the Recent reviews list (see SessionPersistence). */
  readonly reviews: SessionPersistence;
  /** AI suggestions on demand: "Check how it reads", "Improve this sentence" (see AiSuggestions). */
  readonly ai: AiSuggestions;
  /** The writing helper's files are installed (see ControllerDeps.helperInstalled). */
  readonly helperInstalled: boolean;

  private readonly scriptEngines: ReadonlyMap<string, LanguageEngine>;

  constructor(private readonly deps: ControllerDeps) {
    this.scriptEngines = deps.scriptEngines ?? createScriptEngines();
    this.helperInstalled = deps.helperInstalled ?? true;
    this.saveHost = {
      state: () => this.state,
      set: (patch) => this.set(patch),
      flush: () => this.queue.flush(),
      loaded: () => this.loaded,
      saveRefused: () => this.typingRefused,
      files: deps.files,
      changes: () => this.changes,
      markSaved: (changes) => (this.savedChanges = changes),
    };
    this.reviews = new SessionPersistence(this.reviewsHost(), deps.sessions ? new SessionStore(deps.sessions) : null);
    this.adapterFor = deps.adapterFor ?? registryAdapterFor;
    this.helperHost = {
      state: () => this.state,
      set: (patch) => this.set(patch),
      optional: new OptionalModules({ loadDictionary: deps.loadDictionary, startHelper: deps.startHelper, stopHelper: deps.stopHelper }),
      models: deps.models,
      updateSettings: (patch) => settingsActions.updateSettings(this.settingsHost, patch),
      clock: deps.now && (() => deps.now!().getTime()), // also times the helper
    };
    this.state = {
      phase: 'empty',
      document: null,
      session: null,
      settings: deps.settings,
      variantOverride: null,
      notice: null,
      error: null,
      checking: false,
      opening: null,
      decided: 0,
      documentIgnoredRules: [],
      announcement: null,
      undoOffer: null,
      resumeOffer: null,
      recentReviews: [],
      checkingModel: false,
      helperBackend: null,
      ai: NO_AI,
      revision: 0,
      textChanges: 0,
    };
    this.ai = new AiSuggestions({
      ...this.helperHost,
      helperInstalled: this.helperInstalled,
      announce: (message) => this.set({ announcement: { message, seq: ++this.announcements } }),
      applyRewrites: (ids) => this.act((s) => s.applyRewrites(ids), () => this.tally.made(ids.length), 'verb.applied'),
    });
    // Title-case entries saved before Task F29 are lowercased once, and saved ("Cutover" → "cutover").
    const dictionary = withTitleCaseLowered(deps.settings.dictionary);
    if (dictionary !== deps.settings.dictionary) settingsActions.updateSettings(this.settingsHost, { dictionary });
    // Web plan, Review focus 1: a browser that keeps nothing, from the start or once writes fail, is said once.
    deps.onStorageLost?.(() => this.showNotice(msg('notice.noStorage')));
  }

  /** What SessionPersistence sees of the controller: the settings and save actions' hosts, and the check. */
  private reviewsHost(): PersistenceHost {
    return {
      ...this.settingsHost,
      ...this.saveHost,
      tally: this.tally,
      linter: () => this.getLinter(),
      now: this.deps.now,
      showSession: (session) => {
        ++this.checks; // a check still running would replace the resumed session
        this.ai.reset(); // AI answers are not saved, and none are replayed
        this.reviewChanged({ phase: 'ready', session, decided: this.tally.decided, checking: this.queue.waiting });
      },
      announce: (message) => this.set({ announcement: { message, seq: ++this.announcements } }),
      opener: this,
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
    return this.changes !== this.savedChanges;
  }

  // ---- opening -------------------------------------------------------------

  async open(): Promise<void> {
    const file = await this.deps.files.open();
    if (file) await this.openFile(file);
  }

  /** True when a file named `name` is one Kashiro opens (.docx, .txt, .md): a dropped file is checked before it is read. */
  canOpen(name: string): boolean {
    return this.adapterFor(name) !== null;
  }

  async openFile(file: OpenedFile): Promise<void> {
    const adapter = this.adapterFor(file.name);
    if (!adapter) {
      this.set({ error: msg('error.unsupported', { name: file.name }) });
      return;
    }
    await this.load(file.name, file.path, adapter, file.bytes, true);
  }

  /** Starts an untitled plain-text document (paste or type). */
  async openText(text: string): Promise<void> {
    await this.load(PASTED_NAME, null, this.adapterFor(PASTED_NAME)!, new TextEncoder().encode(text));
  }

  /** "Try a sample paragraph": a built-in text with one of each card, opened like pasted text. */
  async openSample(): Promise<void> {
    await this.load(SAMPLE_NAME, null, this.adapterFor(SAMPLE_NAME)!, new TextEncoder().encode(SAMPLE_TEXT));
  }

  /** `isFile`: an opened file (one with no text is refused), not a paste or the sample. */
  private async load(name: string, path: string | null, adapter: FormatAdapter, bytes: Uint8Array, isFile = false): Promise<void> {
    let read: { loaded: LoadedFile; document: OpenDocument };
    this.set({ opening: name });
    try {
      read = await readDocument(this.documents + 1, name, path, adapter, bytes, isFile);
    } catch (e) {
      // The open document (if any) stays as it was, typing included; nothing is written.
      this.set({ error: openError(name, e), opening: null });
      return;
    }
    this.queue.cancel();
    const { loaded, document } = read;
    await this.reviews.leave();
    this.documents = document.id;
    this.loaded = loaded;
    this.typingRefused = null;
    this.savedChanges = this.changes;
    this.tally.reset();
    this.ai.reset();
    this.reviewChanged({
      phase: 'checking',
      document,
      session: null,
      variantOverride: null,
      notice: null,
      error: null,
      checking: true,
      opening: null,
      decided: this.tally.decided,
      documentIgnoredRules: [],
      announcement: { message: msg('announce.checking'), seq: ++this.announcements },
    });
    await this.queue.track(this.check(false));
    await this.reviews.opened(document, bytes);
  }

  // ---- checking ------------------------------------------------------------

  /** Typing in the editor (the text read back with the document's line separator): re-checks after a 300 ms pause. */
  editText(text: string): void {
    if (!this.state.document?.editable) return;
    this.changes++;
    this.queue.push(text);
    this.reviewChanged({ checking: true, textChanges: this.state.textChanges + 1 });
  }

  private async checkTypedText(text: string): Promise<void> {
    const document = this.state.document;
    if (!document || !this.loaded) return;
    let read: { loaded: LoadedFile; document: OpenDocument };
    try {
      read = await readTypedText(this.loaded, document, text);
    } catch (e) {
      // Too long to check, say: a save now would write the file without the typed text, so saves wait for a shorter one.
      if (e instanceof UnreadableFileError) this.typingRefused = openError(document.name, e);
      this.set({ error: this.typingRefused ?? explain(msg('error.typed'), e, msg('error.typedNext')), checking: this.queue.waiting });
      return;
    }
    this.typingRefused = null;
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
    // The session is changed in place, so a decision made while this check runs still reaches carryDecisions.
    const before = keepDecisions ? this.state.session : null;
    // Between chunks the browser handles input, so the panel stays usable during a long check (F20 item 6); a check
    // a newer one replaced stops at its next pause.
    const pause = async () => {
      await (this.deps.yieldToBrowser ?? yieldToBrowser)();
      if (run !== this.checks) throw new CheckSuperseded();
    };
    try {
      const linter = await this.getLinter();
      const { settings, variantOverride, documentIgnoredRules } = this.state;
      const options = checkOptions(settings, variantOverride, documentIgnoredRules, loaded.adapter.language);
      const session = await CheckSession.start(loaded.paras, options, { linter, now: this.deps.now, pause, scriptEngines: this.scriptEngines });
      if (run !== this.checks) return;
      // The depth may have moved while the check ran.
      session.setDepth(currentDepth(this.state.settings));
      let applyLost = false;
      let rewriteDropped = false;
      if (before) {
        const { unchanged, copies } = matchParagraphs(before.paragraphs(), loaded.paras);
        const decisions = userDecisions(before);
        // An Apply pressed in the typing pause went to the old text; if its paragraph changed, nothing carries it (#34).
        applyLost = decisions.some((d) => d.status === 'applied' && this.appliedWhileChecking.has(d.candidateId) && !unchanged.has(d.paraId));
        // AI answers after the rule decisions: a rewrite was made for its sentence with the accepted fixes in it.
        const carried = carryDecisions(decisions, session, unchanged, copies);
        this.tally.remap(new Map([...carried, ...this.ai.sessionReplaced(before, session, unchanged)]));
        // An applied AI rewrite that could not be placed again went back to the original sentence (#39).
        rewriteDropped = session.droppedAppliedRewrites().length > 0;
      }
      // Typing queued behind this check: a fix applied in a paragraph it left alone may be lost by the next one.
      if (!this.queue.waiting) this.appliedWhileChecking.clear();
      // A new document's result is announced; a re-check while typing stays quiet.
      // Never let "nothing to decide" read as an all-clear for text that was not checked, as the panel says it.
      const setAside = session.otherScriptParagraphs().length;
      const passages = session.uncheckedPassages().length;
      // Whole paragraphs of another script only: the older wording fits; a passage can be any language.
      const labels = proofreadingLabels(session);
      const checked =
        passages > 0
          ? labels.announcePassages
          : setAside > 0
            ? labels.announceOnly
            : !session.hasCheckedText()
              ? 'announce.nothingToCheck'
              : 'announce.checked';
      const finished = withNotChecked(msg(checked, { count: session.rankedDecisionCount() }), session.uncheckedParagraphs().length);
      const announcement = before ? {} : { announcement: { message: finished, seq: ++this.announcements } };
      // "Nothing can be saved until the text is checked" (or a save refused for it) is no longer true.
      const error = this.state.error;
      const outdated = error !== null && (error === this.checkFailure || error.key === 'error.saveNotChecked');
      this.checkFailure = null;
      // A new session: an undo toast's places and batch belong to the old one.
      this.reviewChanged({
        phase: 'ready',
        session,
        checking: this.queue.waiting,
        ...announcement,
        ...(outdated ? { error: null } : {}),
        // One notice slot: a lost Apply names a paragraph the user typed in, so it wins over a dropped rewrite.
        ...(applyLost ? { notice: msg('notice.applyLostToTyping') } : rewriteDropped ? { notice: msg('notice.rewriteDropped') } : {}),
      });
      if (before) this.reviews.changed();
      // After every check, so a goal switch (whose own modules may differ) releases too.
      this.releaseModules(session.modules);
    } catch (e) {
      if (run !== this.checks) return;
      // Typed text that failed its check: the session still holds the older text, so save() refuses until a check works.
      const stale = this.state.session !== null && !sameParagraphs(this.state.session.paragraphs(), loaded.paras);
      const error = explain(msg('error.check'), e, msg(stale ? 'error.checkNextNotSaved' : 'error.checkNext'));
      this.checkFailure = error;
      this.set({ phase: this.state.session ? 'ready' : 'empty', error, checking: this.queue.waiting });
      // A switch turned off before this re-check must still stop its module.
      this.releaseModules(modulesFor(this.state.settings));
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
    const said = flagOnly ? 'verb.dismissed' : verb;
    this.act(change, () => this.tally.rejected(decisionId, places), said, () => rejectedOffer(places, said, ++this.offers));
  }

  /** "Apply" after the batch preview: the chosen places as one change, undone together by undoBatch. */
  applyBatch(decisionId: string, candidateIds: string[], replacementIndex = 0): void {
    let batchId = '';
    this.act(
      (s) => (batchId = s.applyBatch(decisionId, candidateIds, replacementIndex)),
      () => this.tally.made(1),
      'verb.applied',
      (s) => appliedOffer(s, batchId, ++this.offers),
    );
  }

  /**
   * The undo toast's Undo (Task F21b item 8): takes back exactly what its action did, with the engine's own undo. An
   * applied batch is undone (applied → rejected) and then sent back to review, as it was before the Apply; rejected
   * places go back to review, as "Review again" in the change log does. Returns the first place back in review, for
   * the panel to show, or null when there was nothing to undo.
   */
  undoBigAction(): string | null {
    const offer = this.state.undoOffer;
    const session = this.state.session;
    if (!offer || !session) return null;
    if (offer.kind === 'applied') {
      const ids = appliedInBatch(session, offer.batchId);
      this.act(
        (s) => {
          s.undoBatch(offer.batchId);
          for (const id of ids) s.undo(id);
        },
        () => this.tally.made(-1),
        'verb.undone',
      );
      return ids[0] ?? null;
    }
    this.act(
      (s) => offer.ids.forEach((id) => s.undo(id)),
      () => offer.ids.forEach((id) => this.tally.reopen(id)),
      'verb.backToReview',
    );
    return offer.ids[0];
  }

  /** The undo toast timed out or was dismissed. */
  dismissUndoOffer(): void {
    if (this.state.undoOffer) this.set({ undoOffer: null });
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

  /** See settingsActions.addTypedWord. */
  async addDictionaryWord(word: string): Promise<void> {
    await settingsActions.addTypedWord(this.settingsHost, word);
  }

  /** See settingsActions.mergeDictionaryDuplicates. */
  mergeDictionaryDuplicates(): Promise<number> {
    return settingsActions.mergeDictionaryDuplicates(this.settingsHost);
  }

  /** See settingsActions.importDictionaryWords. */
  importDictionaryWords(words: readonly string[]): Promise<void> {
    return settingsActions.importDictionaryWords(this.settingsHost, words);
  }

  /** See settingsActions.setModule. */
  setModule(name: keyof ModuleSwitches, on: boolean): void {
    settingsActions.setModule(this.settingsHost, name, on);
    void this.reviews.refresh(); // the Saved reviews switch shows or hides the Recent reviews list
  }

  /** "Use different modules for this goal" (default: the current goal). */
  useModulesForPreset(on: boolean, preset: PresetId = this.state.settings.preset): void {
    settingsActions.useModulesForPreset(this.settingsHost, on, preset);
  }

  /** The offline dictionary, loaded on first use; null while word lookup is off. */
  dictionary(): Promise<Dictionary> | null {
    return this.helperHost.optional.dictionary(modulesFor(this.state.settings));
  }

  /** See helperActions.helper. */
  helper(): Promise<Rewriter> | null {
    return helperActions.helper(this.helperHost);
  }

  /** See helperActions.benchmarkHelper. */
  benchmarkHelper(signal: AbortSignal): Promise<{ seconds: number; slow: boolean } | null> {
    return helperActions.benchmarkHelper(this.helperHost, signal);
  }

  /** See helperActions.chooseModel. A new model file is timed on its first use. */
  async chooseModel(): Promise<void> {
    await helperActions.chooseModel(this.helperHost);
    this.ai.measureSpeedIfNeeded();
  }

  private releaseModules(modules: ModuleSwitches): void {
    if (!modules.aiRewrites) this.ai.stop();
    helperActions.releaseModules(this.helperHost, modules);
  }

  /**
   * Runs a review action and, only once it succeeded, `count` (how it moves the tally of decisions made) and
   * the announcement "<verb>. N of M left.". A failure is shown, not thrown.
   */
  /**
   * Makes a change to the review: `change` on the session, then `count` on the tally. `offer` gives the undo toast
   * a big action shows; any other change takes an earlier toast away.
   */
  private act(change: (s: CheckSession) => void, count: () => void, verb: MessageKey, offer?: (s: CheckSession) => UndoOffer | null): void {
    const session = this.state.session;
    if (!session) return;
    const editsBefore = editsOf(session);
    const appliedBefore = this.state.checking ? appliedIds(session) : null;
    try {
      change(session);
    } catch (e) {
      this.set({ error: plainError(e) });
      return;
    }
    if (appliedBefore) for (const id of appliedIds(session)) if (!appliedBefore.has(id)) this.appliedWhileChecking.add(id);
    this.changes++;
    count();
    // A reject or "Review again" changes no text, so an open preview stays.
    const textChanges = this.state.textChanges + (editsOf(session) === editsBefore ? 0 : 1);
    const undoOffer = offer?.(session) ?? null;
    this.set({ error: null, decided: this.tally.decided, announcement: this.announcement(msg(verb)), textChanges, undoOffer });
    this.reviews.changed();
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

  /** A notice from outside the controller ("Put the cursor on a word…" from the ⋯ menu's Look up word). */
  showNotice(notice: Message): void {
    this.set({ notice });
  }

  /** The error banner's ×. */
  dismissError(): void {
    this.set({ error: null });
  }

  /** The notice banner's × (notices also clear on their own, see App.tsx). */
  dismissNotice(): void {
    this.set({ notice: null });
  }

  /**
   * "Close document" (Ctrl+W), after the unsaved-changes guard: the saved review is written now (S3), and the
   * app returns to the empty state with the recent reviews listed.
   */
  async close(): Promise<void> {
    if (!this.state.document) return;
    this.queue.cancel();
    ++this.checks; // a check still running would show its result after the close
    await this.reviews.leave();
    this.loaded = null;
    this.typingRefused = null;
    this.savedChanges = this.changes;
    this.tally.reset();
    this.ai.reset();
    this.reviewChanged({
      phase: 'empty',
      document: null,
      session: null,
      variantOverride: null,
      notice: null,
      error: null,
      checking: false,
      decided: this.tally.decided,
      documentIgnoredRules: [],
      announcement: null,
    });
    await this.reviews.refresh();
  }

  /** Sets `patch` after a change to the review: the undo toast's Undo would no longer match, so the toast goes. */
  private reviewChanged(patch: Partial<ControllerState>): void {
    this.set({ ...patch, undoOffer: null });
  }

  private set(patch: Partial<ControllerState>): void {
    // Every error and notice shown passes here: Report a bug lists the last ones, by key only.
    if (patch.error && patch.error !== this.state.error) this.problems.record('error', patch.error);
    if (patch.notice && patch.notice !== this.state.notice) this.problems.record('notice', patch.notice);
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener();
  }
}
