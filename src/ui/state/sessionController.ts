import { CheckSession } from '@/engine/session';
import { DEFAULT_DEPTH, type ReviewDepth } from '@/engine/depth';
import type { RulesLinter } from '@/engine/linter';
import type { PresetId } from '@/engine/presets';
import type { Paragraph, Variant } from '@/engine/types';
import { adapterFor as registryAdapterFor } from '@/formats/registry';
import type { FormatAdapter } from '@/formats/types';
import { carryDecisions } from './carryDecisions';
import { joinParagraphs, matchUnchangedParagraphs, paragraphStarts } from './documentText';
import { RecheckQueue } from './recheckQueue';
import { saveDocument, saveReport, type Files, type OpenedFile } from './saveFlow';
import type { Settings } from './settings';

export type { Files, OpenedFile, SavedFile } from './saveFlow';

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
  /**
   * The line break the editor splits and joins lines with, so its text round-trips exactly: CRLF for
   * a file that uses only CRLF, LF otherwise (a mixed file keeps its stray CRs inside the lines).
   */
  lineSeparator: '\n' | '\r\n';
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
const UTF8_BOM = [0xef, 0xbb, 0xbf];
/** A line feed without a carriage return before it ("a\nb", but not "a\r\nb"). */
const BARE_LF = /(?:^|[^\r])\n/;

interface LoadedFile {
  adapter: FormatAdapter;
  handle: unknown;
  paras: Paragraph[];
  /** The file started with a UTF-8 byte-order mark: typed text is re-read with it, so the save keeps it. */
  bom: boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const startsWithBom = (bytes: Uint8Array) => UTF8_BOM.every((b, i) => bytes[i] === b);
const lineSeparatorOf = (text: string): '\n' | '\r\n' => (text.includes('\r\n') && !BARE_LF.test(text) ? '\r\n' : '\n');

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
    this.queue.cancel();
    let read: { paras: Paragraph[]; handle: unknown };
    try {
      read = await adapter.read(bytes);
    } catch (e) {
      this.set({ error: `Can't open ${name}: ${message(e)}` });
      return;
    }
    this.loaded = { adapter, ...read, bom: startsWithBom(bytes) };
    this.unsaved = false;
    const isDocx = name.toLowerCase().endsWith('.docx');
    const text = isDocx ? null : new TextDecoder().decode(bytes); // the decoder drops a byte-order mark
    const view = text === null ? joinParagraphs(read.paras) : { text, starts: paragraphStarts(text, read.paras) };
    const document: OpenDocument = {
      id: ++this.documents,
      name,
      path,
      text: view.text,
      lineSeparator: text === null ? '\n' : lineSeparatorOf(text),
      editable: !isDocx,
      paraStarts: view.starts,
      note: isDocx ? DOCX_NOTE : null,
    };
    this.set({ phase: 'checking', document, session: null, variantOverride: null, notice: null, error: null });
    await this.queue.track(this.check(false));
  }

  // ---- checking ------------------------------------------------------------

  /** Typing in the editor (the text read back with the document's line separator): re-checks after a 300 ms pause. */
  editText(text: string): void {
    if (!this.state.document?.editable) return;
    this.unsaved = true;
    this.queue.push(text);
  }

  private async checkTypedText(text: string): Promise<void> {
    const document = this.state.document;
    if (!document || !this.loaded) return;
    const { adapter, bom } = this.loaded;
    const encoded = new TextEncoder().encode(text);
    let read: { paras: Paragraph[]; handle: unknown };
    try {
      read = await adapter.read(bom ? new Uint8Array([...UTF8_BOM, ...encoded]) : encoded);
    } catch (e) {
      this.set({ error: `The typed text could not be checked: ${message(e)}` });
      return;
    }
    this.loaded = { adapter, ...read, bom };
    this.set({ document: { ...document, text, paraStarts: paragraphStarts(text, read.paras) } });
    await this.check(true);
  }

  /** Re-checks the current document, keeping the decisions on paragraphs that did not change. */
  private recheck(): Promise<void> {
    return this.loaded ? this.queue.track(this.check(true)) : Promise.resolve();
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
      // The depth may have moved while the check ran.
      session.setDepth(this.currentDepth());
      if (before) carryDecisions(before, session, matchUnchangedParagraphs(before.paragraphs(), loaded.paras));
      this.set({ phase: 'ready', session });
    } catch (e) {
      if (run === this.checks) this.set({ phase: this.state.session ? 'ready' : 'empty', error: `The check failed: ${message(e)}` });
    }
  }

  private currentDepth(): ReviewDepth {
    const { depthByPreset, preset } = this.state.settings;
    return depthByPreset[preset] ?? DEFAULT_DEPTH;
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
      depth: this.currentDepth(),
      termMinRepeats: settings.termMinRepeats,
    };
  }

  private getLinter(): Promise<RulesLinter> {
    const { fallbackVariant, dictionary } = this.state.settings;
    this.linter ??= this.deps.createLinter(fallbackVariant, [...dictionary]);
    return this.linter;
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

  /** The terms card: every term joins the dictionary except `keepAsTypos`, which become their own decisions. */
  async acceptTerms(keepAsTypos: string[]): Promise<void> {
    await this.actAsync((s) => s.acceptTerms(keepAsTypos));
  }

  /** Review depth for `preset` (default: the current one), saved per preset; the current one applies at once. */
  setDepth(depth: ReviewDepth, preset: PresetId = this.state.settings.preset): void {
    const { settings } = this.state;
    if (preset === settings.preset) this.state.session?.setDepth(depth);
    this.updateSettings({ depthByPreset: { ...settings.depthByPreset, [preset]: depth } });
  }

  setPreset(preset: PresetId): void {
    this.updateSettings({ preset });
    void this.recheck();
  }

  /** null goes back to the detected variant. */
  setVariant(variant: Variant | null): void {
    this.set({ variantOverride: variant });
    void this.recheck();
  }

  /**
   * Settings that need no new check (save mode, overwrite) or that do (auto-apply kinds, default variant,
   * terms repeat count).
   */
  changeSettings(
    patch: Partial<Pick<Settings, 'saveMode' | 'overwrite' | 'fallbackVariant' | 'tierOverrides' | 'termMinRepeats'>>,
  ): void {
    this.updateSettings(patch);
    if (patch.tierOverrides || patch.fallbackVariant || patch.termMinRepeats) void this.recheck();
  }

  /** Harper can't forget an imported word, so the linter is rebuilt without it. */
  async removeWord(word: string): Promise<void> {
    this.updateSettings({ dictionary: this.state.settings.dictionary.filter((w) => w !== word) });
    this.linter = null;
    await this.recheck();
  }

  private act(change: (s: CheckSession) => void): void {
    const session = this.state.session;
    if (!session) return;
    try {
      change(session);
      this.unsaved = true;
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
    this.unsaved = true;
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

  /**
   * Writes the document with the accepted edits: a tracked or clean copy, or over the file after a
   * backup. Returns true when the file was written (false when cancelled or failed).
   */
  async save(): Promise<boolean> {
    await this.queue.flush();
    const { session, document, settings } = this.state;
    if (!session || !document || !this.loaded) return false;
    const { adapter, handle } = this.loaded;
    try {
      const notice = await saveDocument({ session, adapter, handle, name: document.name, path: document.path, settings, files: this.deps.files });
      // Unplaceable edits may have been marked on the session, so this always re-renders.
      this.set({ notice, error: null });
      if (notice === null) return false;
      this.unsaved = false;
      return true;
    } catch (e) {
      this.set({ error: `Couldn't save ${document.name}: ${message(e)}` });
      return false;
    }
  }

  /** Saves the change report (Markdown) beside the document. The document itself still counts as unsaved. */
  async exportReport(): Promise<void> {
    await this.queue.flush();
    const { session, document } = this.state;
    if (!session || !document) return;
    try {
      this.set({ notice: await saveReport(session, document.name, document.path, this.deps.files), error: null });
    } catch (e) {
      this.set({ error: `Couldn't save the report: ${message(e)}` });
    }
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
