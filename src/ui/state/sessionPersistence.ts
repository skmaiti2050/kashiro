import type { ReviewDepth } from '@/engine/depth';
import type { RulesLinter } from '@/engine/linter';
import type { PresetId } from '@/engine/presets';
import type { CheckSession } from '@/engine/session';
import { restore, snapshot } from '@/engine/sessionSnapshot';
import { sha256Hex } from '@/engine/sha256';
import { msg, type Message } from '../i18n/message';
import { checkOptions, currentDepth } from './checkOptions';
import type { DecisionTally } from './decisionTally';
import { explain } from './errors';
import type { LoadedFile, OpenDocument } from './openDocument';
import { progressOf } from './progress';
import { SAMPLE_NAME } from './sample';
import type { Files, OpenedFile } from './saveFlow';
import type { ControllerState } from './sessionController';
import { SessionStore, type RecentReview, type SavedReview } from './sessionStore';
import { modulesFor, type Settings } from './settings';

/** What saving and resuming reviews need from the controller. */
export interface PersistenceHost {
  state(): ControllerState;
  set(patch: Partial<ControllerState>): void;
  /** The open document's paragraphs and adapter; null with nothing open. */
  loaded(): LoadedFile | null;
  tally: DecisionTally;
  linter(): Promise<RulesLinter>;
  now(): Date;
  /** Shows the new settings and saves them. */
  storeSettings(settings: Settings): void;
  /** Shows a resumed session in place of the fresh check's, dropping any check still running. */
  showSession(session: CheckSession): void;
  announce(message: Message): void;
  markUnsaved(): void;
  files: Files;
  openFile(file: OpenedFile): Promise<void>;
  openText(text: string): Promise<void>;
}

/** "Resume your review? (N decisions made, M left)"; `changed`: the file changed since (same path, other bytes). */
export interface ResumeOffer {
  made: number;
  left: number;
  changed: boolean;
}

/** Saved after the user's last decision has rested this long (plan: 1 s). */
const AUTOSAVE_DELAY_MS = 1000;

/** A saved review and where it is kept. */
interface Found {
  key: string;
  review: SavedReview;
}

/**
 * Saved review sessions (Task S3): autosaves the open review a second after each change, offers to resume
 * a file's saved review when it is opened again, and keeps the Recent reviews list. Files are keyed by a
 * SHA-256 of their bytes plus their path; pasted text by a random id, and only with "Keep pasted text" on.
 * Nothing is saved or loaded while the Saved reviews module is off or the retention is 0.
 */
export class SessionPersistence {
  private readonly store: SessionStore | null;
  /** Where the open document's review is saved; null when it is not saved (sample, pasted text, switched off). */
  private key: string | null = null;
  /** The saved review offered for the open document, while the user hasn't answered. */
  private offered: Found | null = null;
  /** Picked in the Recent reviews list: resumed without asking once its document opens. */
  private picked: Found | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Writes run one after another, so an older snapshot never lands after a newer one. */
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: PersistenceHost,
    store: SessionStore | null,
  ) {
    this.store = store;
  }

  /** At start-up: deletes reviews past the retention, then lists the rest. */
  async startUp(): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.prune(this.host.state().settings.sessionRetentionDays);
    } catch (e) {
      this.host.set({ error: explain(msg('error.reviewsRead'), e, msg('error.reviewsReadNext')) });
    }
    await this.refresh();
  }

  /** Re-reads the Recent reviews list (empty while saving is off). */
  async refresh(): Promise<void> {
    if (!this.store) return;
    try {
      this.host.set({ recentReviews: this.enabled() ? await this.store.list() : [] });
    } catch (e) {
      this.host.set({ error: explain(msg('error.reviewsRead'), e, msg('error.reviewsReadNext')) });
    }
  }

  // ---- opening -------------------------------------------------------------

  /** Before another document opens: saves what is waiting, and stops saving to the old review. */
  async leave(): Promise<void> {
    await this.flush();
    this.key = null;
    if (this.offered) this.host.set({ resumeOffer: null });
    this.offered = null;
  }

  /** The document's first check is done: finds its saved review and offers it, or starts saving a new one. */
  async opened(document: OpenDocument, bytes: Uint8Array): Promise<void> {
    const picked = this.picked;
    this.picked = null;
    if (!this.store || !this.enabled() || document.name === SAMPLE_NAME) return;
    if (document.path === null) return this.openedPastedText(picked);
    const key = await sha256Hex(withPath(bytes, document.path));
    const found = await this.findReview(key, document.path);
    if (this.host.state().document?.id !== document.id) return; // another document opened meanwhile
    // Nothing is written until the user decides something: opening a file alone saves no review.
    this.key = key;
    if (!found) return;
    const changed = found.key !== key;
    if (picked?.key === found.key && !changed) return this.resumeFrom(found);
    this.offered = found;
    this.host.set({ resumeOffer: { made: found.review.made, left: found.review.left, changed } });
  }

  private async openedPastedText(picked: Found | null): Promise<void> {
    if (picked?.review.path === null) {
      this.key = picked.key;
      return this.resumeFrom(picked);
    }
    if (this.host.state().settings.keepPastedText) this.key = crypto.randomUUID();
  }

  /** The review saved under `key`, or else the latest one of the same path (the file changed since). */
  private async findReview(key: string, path: string): Promise<Found | null> {
    try {
      const review = await this.store!.load(key);
      if (review) return { key, review };
      const older = (await this.store!.list()).find((r) => r.path === path);
      const olderReview = older && (await this.store!.load(older.key));
      return olderReview ? { key: older.key, review: olderReview } : null;
    } catch (e) {
      this.host.set({ error: explain(msg('error.reviewsRead'), e, msg('error.reviewsReadNext')) });
      return null;
    }
  }

  // ---- resume prompt -------------------------------------------------------

  /** "Resume": replays the saved decisions on the paragraphs that did not change. */
  async resume(): Promise<void> {
    const found = this.offered;
    if (!found) return;
    this.offered = null;
    this.host.set({ resumeOffer: null });
    await this.resumeFrom(found);
  }

  /** "Start fresh": forgets the saved review; the next decision starts a new one. */
  async startFresh(): Promise<void> {
    const found = this.offered;
    if (!found) return;
    this.offered = null;
    this.host.set({ resumeOffer: null });
    await this.deleteReview(found.key);
  }

  /** Escape on the prompt: neither resumes nor forgets. The saved review stays, so this visit saves nothing over it. */
  dismiss(): void {
    if (!this.offered) return;
    this.offered = null;
    this.key = null;
    this.host.set({ resumeOffer: null });
  }

  private async resumeFrom({ key, review }: Found): Promise<void> {
    const { host } = this;
    const loaded = host.loaded();
    const document = host.state().document;
    if (!loaded || !document) return;
    const snap = review.snapshot;
    const settings = withReviewPreset(host.state().settings, snap.preset, snap.depth);
    if (settings !== host.state().settings) host.storeSettings(settings);
    host.set({ variantOverride: snap.variantOverride, documentIgnoredRules: [...snap.documentIgnoredRules], checking: true });
    try {
      const options = checkOptions(settings, snap.variantOverride, snap.documentIgnoredRules, loaded.adapter.language);
      const { session, restored, rechecked } = await restore(loaded.paras, snap, options, { linter: await host.linter(), now: () => host.now() });
      if (host.state().document?.id !== document.id) return;
      host.tally.reset();
      // Cards and dictionary words count in `made` but are not replayed: the saved count holds only if all came back.
      host.tally.made(restored === snap.decisions.length ? review.made : Math.min(review.made, restored));
      host.showSession(session);
      if (restored > 0) host.markUnsaved();
      host.announce(msg('resume.done', { restored, rechecked }));
    } catch (e) {
      host.set({ error: explain(msg('error.resume'), e, msg('error.resumeNext')), checking: false });
      return;
    }
    // A changed file's review moves to the new fingerprint at once, so it is never only half there.
    if (key === this.key) return;
    await this.write();
    await this.deleteReview(key);
  }

  // ---- autosave ------------------------------------------------------------

  /** The review changed: saves it once it has rested for AUTOSAVE_DELAY_MS. */
  changed(): void {
    if (!this.key || this.offered || !this.enabled()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.write();
    }, AUTOSAVE_DELAY_MS);
  }

  /** Saves a waiting change now (before closing or opening another document) and waits for every write. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      void this.write();
    }
    await this.writing;
  }

  private write(): Promise<void> {
    this.writing = this.writing.then(() => this.save());
    return this.writing;
  }

  private async save(): Promise<void> {
    const { session, document, settings, variantOverride, documentIgnoredRules } = this.host.state();
    const key = this.key;
    if (!this.store || !key || !session || !document || !this.enabled()) return;
    const made = this.host.tally.decided;
    try {
      const review: SavedReview = {
        name: document.name,
        path: document.path,
        updated: this.host.now().toISOString(),
        made,
        left: progressOf(session, made).left,
        snapshot: await snapshot(session, { preset: settings.preset, variantOverride, documentIgnoredRules }),
      };
      // Only pasted text is ever stored, and only with the opt-in (a pasted review has no key without it).
      if (document.path === null) review.text = document.text;
      await this.store.save(key, review);
    } catch (e) {
      this.host.set({ error: explain(msg('error.reviewSave'), e, msg('error.reviewSaveNext')) });
      return;
    }
    await this.refresh();
  }

  // ---- recent list and settings --------------------------------------------

  /** Recent reviews › a row: pasted text reopens from its saved text; a file through the Open dialog at its path. */
  async openRecent(recent: RecentReview): Promise<void> {
    if (!this.store) return;
    const review = await this.store.load(recent.key);
    if (!review) return this.refresh();
    if (review.path === null) {
      if (review.text === undefined) return;
      this.picked = { key: recent.key, review };
      return this.host.openText(review.text);
    }
    const file = await this.host.files.open(review.path);
    if (!file) return;
    this.picked = { key: recent.key, review };
    await this.host.openFile(file);
  }

  /** Settings › Delete all saved reviews. */
  async deleteAll(): Promise<void> {
    if (!this.store) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.writing;
    await this.runStoreChange(() => this.store!.prune(0));
    this.host.announce(msg('reviews.deleted'));
  }

  /** Settings › Keep saved reviews for: a shorter time deletes what is now too old. */
  async setRetention(days: number): Promise<void> {
    this.host.storeSettings({ ...this.host.state().settings, sessionRetentionDays: days });
    if (this.store) await this.runStoreChange(() => this.store!.prune(days));
  }

  /** Settings › Keep pasted text for resuming: off deletes the pasted text already kept. */
  async setKeepPastedText(on: boolean): Promise<void> {
    this.host.storeSettings({ ...this.host.state().settings, keepPastedText: on });
    if (on || !this.store) return;
    if (this.host.state().document?.path === null) this.key = null;
    await this.writing;
    await this.runStoreChange(async () => {
      for (const review of await this.store!.list()) if (review.path === null) await this.store!.delete(review.key);
    });
  }

  private async deleteReview(key: string): Promise<void> {
    await this.runStoreChange(() => this.store!.delete(key));
  }

  /** Runs a deletion, shows a failure, and re-reads the list either way. */
  private async runStoreChange(change: () => Promise<void>): Promise<void> {
    try {
      await change();
    } catch (e) {
      this.host.set({ error: explain(msg('error.reviewsDelete'), e, msg('error.reviewsDeleteNext')) });
    }
    await this.refresh();
  }

  private enabled(): boolean {
    const { settings } = this.host.state();
    return this.store !== null && modulesFor(settings).savedSessions && settings.sessionRetentionDays > 0;
  }
}

/** The file's bytes followed by its path (UTF-8): the same file elsewhere is another review. */
function withPath(bytes: Uint8Array, path: string): Uint8Array {
  const pathBytes = new TextEncoder().encode(path);
  const data = new Uint8Array(bytes.length + pathBytes.length);
  data.set(bytes);
  data.set(pathBytes, bytes.length);
  return data;
}

/** The settings with the review's goal and its depth, or the same object when they already match. */
function withReviewPreset(settings: Settings, preset: PresetId, depth: ReviewDepth): Settings {
  if (settings.preset === preset && currentDepth(settings) === depth) return settings;
  return { ...settings, preset, depthByPreset: { ...settings.depthByPreset, [preset]: depth } };
}
