import { CheckSession, type Edit } from '@/engine/session';
import { exportReport } from '@/engine/report';
import type { ReviewDepth } from '@/engine/depth';
import type { RulesLinter } from '@/engine/linter';
import type { PresetId } from '@/engine/presets';
import type { Paragraph, Variant } from '@/engine/types';
import { adapterFor as registryAdapterFor } from '@/formats/registry';
import type { FormatAdapter } from '@/formats/types';
import { carryDecisions } from './carryDecisions';
import { joinParagraphs, matchUnchangedParagraphs, paragraphStarts, siblingPath } from './documentText';
import type { Settings } from './settings';

export interface OpenedFile {
  name: string;
  /** Null when the bytes came without a path (nothing to overwrite). */
  path: string | null;
  bytes: Uint8Array;
}

/** File access (platform/files.ts in the app, an in-memory fake in tests). */
export interface Files {
  /** Asks the user for a file; null when they cancel. */
  open(): Promise<OpenedFile | null>;
  /**
   * Writes `bytes`. With `overwrite`, backs up `path` first (`name.bak.ext`) and writes over it; otherwise
   * lets the user confirm or change the suggested `path`. Returns the path written, or null when cancelled.
   */
  save(path: string, bytes: Uint8Array, opts: { overwrite: boolean }): Promise<string | null>;
}

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
}

export interface OpenDocument {
  /** New for every opened file or paste, so the editor knows when to replace its content. */
  id: number;
  name: string;
  path: string | null;
  /** The text in the document view: the file's text, or a .docx's paragraphs separated by blank lines. */
  text: string;
  /** Plain text and Markdown can be edited in place; .docx is read-only. */
  editable: boolean;
  /** Paragraph id → its start offset in `text`. */
  paraStarts: Map<number, number>;
  /** A short note about what this format leaves unchecked. */
  note: string | null;
}

export interface ControllerState {
  phase: 'empty' | 'checking' | 'ready';
  document: OpenDocument | null;
  session: CheckSession | null;
  settings: Settings;
  /** The variant the user picked for this document, or null to use the detected one. */
  variantOverride: Variant | null;
  notice: string | null;
  error: string | null;
  /** Bumped on every change: the session is mutable, so views re-read it when this moves. */
  revision: number;
}

export const DOCX_NOTE = 'Headers, footers and footnotes are kept as they are but not checked in this version.';
const RECHECK_DELAY_MS = 300;
const PASTED_NAME = 'Untitled.txt';
interface LoadedFile {
  adapter: FormatAdapter;
  handle: unknown;
  paras: Paragraph[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sameEdit = (a: Edit, paraId: number, start: number, end: number, replacement: string | undefined) =>
  a.paraId === paraId && a.span.start === start && a.span.end === end && a.replacement === replacement;

/**
 * The desktop flow without React: open → check → review → save. Holds one document and its
 * CheckSession, re-checks typed text after a pause (keeping decisions on unchanged paragraphs), and
 * keeps the personal dictionary and other settings in step with the session.
 */
export class SessionController {
  private state: ControllerState;
  private readonly listeners = new Set<() => void>();
  private readonly adapterFor: (fileName: string) => FormatAdapter | null;
  private linter: Promise<RulesLinter> | null = null;
  private loaded: LoadedFile | null = null;
  private documents = 0;
  /** Checks started; a check whose number is no longer the latest drops its result. */
  private checks = 0;
  private inFlight: Promise<void> = Promise.resolve();
  private pendingText: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ControllerDeps) {
    this.adapterFor = deps.adapterFor ?? registryAdapterFor;
    const settings = deps.settings;
    this.state = { phase: 'empty', document: null, session: null, settings, variantOverride: null, notice: null, error: null, revision: 0 };
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
  async settled(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.inFlight;
      await current;
    } while (current !== this.inFlight);
  }

  // ---- opening -------------------------------------------------------------

  async open(): Promise<void> {
    const file = await this.deps.files.open();
    if (file) await this.openFile(file);
  }

  async openFile(file: OpenedFile): Promise<void> {
    const adapter = this.adapterFor(file.name);
    if (!adapter) {
      this.set({ error: `Can't open ${file.name}: writing-check opens .docx, .txt and .md files.` });
      return;
    }
    await this.load(file.name, file.path, adapter, file.bytes);
  }

  /** Starts an untitled plain-text document (paste or type). */
  async openText(text: string): Promise<void> {
    await this.load(PASTED_NAME, null, this.adapterFor(PASTED_NAME)!, new TextEncoder().encode(text));
  }

  private async load(name: string, path: string | null, adapter: FormatAdapter, bytes: Uint8Array): Promise<void> {
    this.cancelPendingEdits();
    let read: { paras: Paragraph[]; handle: unknown };
    try {
      read = await adapter.read(bytes);
    } catch (e) {
      this.set({ error: `Can't open ${name}: ${message(e)}` });
      return;
    }
    this.loaded = { adapter, ...read };
    const isDocx = name.toLowerCase().endsWith('.docx');
    const view = isDocx ? joinParagraphs(read.paras) : this.textView(bytes, read.paras);
    const document: OpenDocument = {
      id: ++this.documents,
      name,
      path,
      text: view.text,
      editable: !isDocx,
      paraStarts: view.starts,
      note: isDocx ? DOCX_NOTE : null,
    };
    this.set({ phase: 'checking', document, session: null, variantOverride: null, notice: null, error: null });
    await this.track(this.check(false));
  }

  private textView(bytes: Uint8Array, paras: Paragraph[]): { text: string; starts: Map<number, number> } {
    const text = new TextDecoder().decode(bytes); // drops a byte-order mark, as the text adapter does
    return { text, starts: paragraphStarts(text, paras) };
  }

  // ---- checking ------------------------------------------------------------

  /** Typing in the editor: re-checks after a 300 ms pause. */
  editText(text: string): void {
    if (!this.state.document?.editable) return;
    this.pendingText = text;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.track(this.applyPendingEdits()), RECHECK_DELAY_MS);
  }

  private cancelPendingEdits(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pendingText = null;
  }

  private async applyPendingEdits(): Promise<void> {
    const text = this.pendingText;
    const document = this.state.document;
    this.cancelPendingEdits();
    if (text === null || !document || !this.loaded) return;
    const { adapter } = this.loaded;
    const read = await adapter.read(new TextEncoder().encode(text));
    this.loaded = { adapter, ...read };
    this.set({ document: { ...document, text, paraStarts: paragraphStarts(text, read.paras) } });
    await this.check(true);
  }

  /** Re-checks the current document, keeping the decisions on paragraphs that did not change. */
  private recheck(): void {
    if (this.loaded) void this.track(this.check(true));
  }

  private async check(keepDecisions: boolean): Promise<void> {
    const loaded = this.loaded!;
    const run = ++this.checks;
    const before = keepDecisions ? this.state.session : null;
    try {
      const linter = await this.getLinter();
      const session = await CheckSession.start(loaded.paras, this.checkOptions(loaded.adapter.language), {
        linter,
        now: this.deps.now,
      });
      if (run !== this.checks) return;
      if (before) carryDecisions(before, session, matchUnchangedParagraphs(before.paragraphs(), loaded.paras));
      this.set({ phase: 'ready', session });
    } catch (e) {
      if (run === this.checks) this.set({ phase: this.state.session ? 'ready' : 'empty', error: `The check failed: ${message(e)}` });
    }
  }

  private checkOptions(language: 'plaintext' | 'markdown') {
    const { settings, variantOverride } = this.state;
    return {
      preset: settings.preset,
      variant: variantOverride ?? undefined,
      fallbackVariant: settings.fallbackVariant,
      language,
      dictionary: settings.dictionary,
      tierOverrides: settings.tierOverrides,
      depth: settings.depthByPreset[settings.preset],
    };
  }

  private getLinter(): Promise<RulesLinter> {
    const { fallbackVariant, dictionary } = this.state.settings;
    this.linter ??= this.deps.createLinter(fallbackVariant, [...dictionary]);
    return this.linter;
  }

  private track(work: Promise<void>): Promise<void> {
    const previous = this.inFlight;
    this.inFlight = previous.then(() => work);
    return work;
  }

  // ---- review --------------------------------------------------------------

  accept(decisionId: string, replacementIndex = 0): void {
    this.act((s) => s.accept(decisionId, replacementIndex));
  }

  reject(decisionId: string): void {
    this.act((s) => s.reject(decisionId));
  }

  ignoreAll(decisionId: string): void {
    this.act((s) => s.ignoreAll(decisionId));
  }

  /** Undo from the change log: applied → rejected, rejected → back to review. */
  undo(candidateId: string): void {
    this.act((s) => s.undo(candidateId));
  }

  async addToDictionary(decisionId: string): Promise<void> {
    await this.actAsync((s) => s.addToDictionary(decisionId));
  }

  /** The names card: every name joins the dictionary except `keepAsTypos`, which become their own decisions. */
  async acceptNames(keepAsTypos: string[]): Promise<void> {
    await this.actAsync((s) => s.acceptNames(keepAsTypos));
  }

  /** Review depth for `preset` (default: the current one), saved per preset; the current one applies at once. */
  setDepth(depth: ReviewDepth, preset: PresetId = this.state.settings.preset): void {
    const { settings } = this.state;
    if (preset === settings.preset) this.state.session?.setDepth(depth);
    this.updateSettings({ depthByPreset: { ...settings.depthByPreset, [preset]: depth } });
  }

  setPreset(preset: PresetId): void {
    this.updateSettings({ preset });
    this.recheck();
  }

  /** null goes back to the detected variant. */
  setVariant(variant: Variant | null): void {
    this.set({ variantOverride: variant });
    this.recheck();
  }

  /** Settings that need no new check (save mode, overwrite, depth) or that do (auto-apply kinds, default variant). */
  changeSettings(patch: Partial<Pick<Settings, 'saveMode' | 'overwrite' | 'fallbackVariant' | 'tierOverrides'>>): void {
    this.updateSettings(patch);
    if (patch.tierOverrides || patch.fallbackVariant) this.recheck();
  }

  /** Harper can't forget an imported word, so the linter is rebuilt without it. */
  async removeWord(word: string): Promise<void> {
    this.updateSettings({ dictionary: this.state.settings.dictionary.filter((w) => w !== word) });
    this.linter = null;
    if (!this.loaded) return;
    await this.track(this.check(true));
  }

  private act(change: (s: CheckSession) => void): void {
    const session = this.state.session;
    if (!session) return;
    try {
      change(session);
      this.set({ error: null });
    } catch (e) {
      this.set({ error: message(e) });
    }
  }

  private async actAsync(change: (s: CheckSession) => Promise<void>): Promise<void> {
    const session = this.state.session;
    if (!session) return;
    try {
      await change(session);
    } catch (e) {
      this.set({ error: message(e) });
      return;
    }
    const known = new Set(this.state.settings.dictionary);
    const added = session.addedWords().filter((w) => !known.has(w));
    this.updateSettings({ dictionary: [...this.state.settings.dictionary, ...added] });
  }

  private updateSettings(patch: Partial<Settings>): void {
    const settings = { ...this.state.settings, ...patch };
    this.set({ settings });
    this.deps.saveSettings(settings).catch((e) => this.set({ error: `Settings were not saved: ${message(e)}` }));
  }

  // ---- saving --------------------------------------------------------------

  /** Writes the document with the accepted edits: a tracked or clean copy, or over the file after a backup. */
  async save(): Promise<void> {
    await this.flushEdits();
    const { session, document, settings } = this.state;
    if (!session || !document || !this.loaded) return;
    try {
      const { bytes, unplaceable } = await this.loaded.adapter.write(this.loaded.handle, session.acceptedEdits(), settings.saveMode);
      for (const { edit, reason } of unplaceable) {
        const outcome = session
          .outcomes()
          .find((o) => o.status === 'applied' && sameEdit(edit, o.candidate.paraId, o.candidate.span.start, o.candidate.span.end, o.replacement));
        if (outcome) session.markUnplaceable(outcome.candidate.id, reason);
      }
      const overwrite = settings.overwrite && document.path !== null;
      const target = overwrite ? document.path! : siblingPath(document.path ?? document.name, '.checked');
      const written = await this.deps.files.save(target, bytes, { overwrite });
      const n = unplaceable.length;
      const unplaced = n ? `; ${n} change${n === 1 ? '' : 's'} couldn't be placed (see the change log)` : '';
      this.set({ notice: written === null ? null : `Saved ${written}${unplaced}`, error: null });
    } catch (e) {
      this.set({ error: `Couldn't save ${document.name}: ${message(e)}` });
    }
  }

  /** Saves the change report (Markdown) beside the document. */
  async exportReport(): Promise<void> {
    await this.flushEdits();
    const { session, document } = this.state;
    if (!session || !document) return;
    try {
      const bytes = new TextEncoder().encode(exportReport(session, document.name));
      const written = await this.deps.files.save(siblingPath(document.path ?? document.name, '.report', '.md'), bytes, { overwrite: false });
      this.set({ notice: written === null ? null : `Saved the report to ${written}`, error: null });
    } catch (e) {
      this.set({ error: `Couldn't save the report: ${message(e)}` });
    }
  }

  /** Runs a waiting re-check now, then waits for every check. */
  private async flushEdits(): Promise<void> {
    if (this.pendingText !== null) await this.track(this.applyPendingEdits());
    await this.settled();
  }

  /** For failures outside the controller (a dropped file that can't be read, the linter not starting). */
  showError(text: string): void {
    this.set({ error: text });
  }

  private set(patch: Partial<ControllerState>): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener();
  }
}
