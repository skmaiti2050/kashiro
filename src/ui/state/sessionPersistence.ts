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
import * as savedReviews from './savedReviewsActions';
import type { Files, OpenedFile } from './saveFlow';
import type { ControllerState } from './sessionController';
import type { KeyedReview, RecentReview, SavedReview, SessionStore } from './sessionStore';
import { modulesFor, type Settings } from './settings';

/** What saving and resuming reviews need from the controller. */
export interface PersistenceHost {
  state(): ControllerState;
  set(patch: Partial<ControllerState>): void;
  /** The open document's paragraphs and adapter; null with nothing open. */
  loaded(): LoadedFile | null;
  tally: DecisionTally;
  linter(): Promise<RulesLinter>;
  /** The clock (default: the system's). */
  now?: () => Date;
  /** Shows the new settings and saves them. */
  storeSettings(settings: Settings): void;
  /** Shows a resumed session in place of the fresh check's, dropping any check still running. */
  showSession(session: CheckSession): void;
  announce(message: Message): void;
  markUnsaved(): void;
  files: Files;
  /** Opens a picked Recent review's document as the Open and Paste commands do. */
  opener: Opener;
}

export interface Opener {
  openFile(file: OpenedFile): Promise<void>;
  openText(text: string): Promise<void>;
}

/** The saved reviews' part of the controller state. */
export interface SavedReviewsState {
  /** A saved review of the opened document, waiting for "Resume" or "Start fresh". */
  resumeOffer: ResumeOffer | null;
  /** The start screen's Recent reviews, newest first. */
  recentReviews: RecentReview[];
}

/** "Resume your review? (N decisions made, M left)"; `changed`: the file changed since (same path, other bytes). */
export interface ResumeOffer {
  made: number;
  left: number;
  changed: boolean;
}

/** Saved after the user's last decision has rested this long (plan: 1 s). */
const AUTOSAVE_DELAY_MS = 1000;

/**
 * Saved review sessions (Task S3): autosaves the open review a second after each change and offers to resume
 * a file's saved review when it is opened again. Files are keyed by a SHA-256 of their bytes plus their path;
 * pasted text by a random id, and only with "Keep pasted text" on. Nothing is saved or loaded while the Saved
 * reviews module is off or the retention is 0. The Recent reviews list and the Settings actions are in
 * savedReviewsActions.ts.
 */
export class SessionPersistence {
  /** Where the open document's review is saved; null when it is not saved (sample, pasted text, switched off). */
  private key: string | null = null;
  /** The document opened() last ran for (OpenDocument.id): a slower, older one drops its result. */
  private documentId: number | null = null;
  /** The saved review offered for the open document, while the user hasn't answered. */
  private offered: KeyedReview | null = null;
  /** Picked in the Recent reviews list: resumed without asking once its document opens. */
  private picked: KeyedReview | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Writes run one after another, so an older snapshot never lands after a newer one; each resolves to its success. */
  private writing: Promise<boolean> = Promise.resolve(true);
  private writesInFlight = 0;
  private readonly list: savedReviews.SavedReviewsHost | null;

  constructor(
    private readonly host: PersistenceHost,
    private readonly store: SessionStore | null,
  ) {
    this.list = store && {
      ...host,
      store,
      enabled: () => this.enabled(),
      pick: (picked) => (this.picked = picked),
      stopSaving: async () => {
        this.cancelTimer();
        await this.writing;
        this.key = null;
      },
    };
  }

  // ---- opening -------------------------------------------------------------

  /** Before another document opens: saves what is waiting, and stops saving to the old review. */
  async leave(): Promise<void> {
    await this.flush();
    this.key = null;
    this.documentId = null;
    if (this.offered) this.host.set({ resumeOffer: null });
    this.offered = null;
  }

  /** The document's first check is done: finds its saved review and offers it. Nothing is written until a decision. */
  async opened(document: OpenDocument, bytes: Uint8Array): Promise<void> {
    const picked = this.picked;
    this.picked = null;
    this.key = null;
    this.documentId = document.id;
    if (!this.store || !this.enabled() || document.name === SAMPLE_NAME) return;
    if (document.path === null) return this.openedPastedText(picked);
    const key = await sha256Hex(withPath(bytes, document.path));
    const found = await this.findReview(key, document.path);
    if (this.documentId !== document.id) return; // another document opened meanwhile
    this.key = key;
    if (!found) return;
    const changed = found.key !== key;
    if (picked?.key === found.key && !changed) return this.resumeFrom(found);
    this.offered = found;
    this.host.set({ resumeOffer: { made: found.review.made, left: found.review.left, changed } });
  }

  private async openedPastedText(picked: KeyedReview | null): Promise<void> {
    if (picked?.review.path === null) {
      this.key = picked.key;
      return this.resumeFrom(picked);
    }
    if (this.host.state().settings.keepPastedText) this.key = crypto.randomUUID();
  }

  /** The review saved under `key`, or else the latest one of the same path (the file changed since). */
  private async findReview(key: string, path: string): Promise<KeyedReview | null> {
    try {
      const review = await this.store!.load(key);
      if (review) return { key, review };
      const older = (await this.store!.list()).reviews.find((r) => r.path === path);
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
    const found = this.takeOffer();
    if (found) await this.resumeFrom(found);
  }

  /** "Start fresh": forgets the saved review; the next decision starts a new one. */
  async startFresh(): Promise<void> {
    const found = this.takeOffer();
    if (found) await savedReviews.runStoreChange(this.list!, () => this.store!.delete(found.key));
  }

  /** Escape on the prompt: neither resumes nor forgets. The saved review stays, so this visit saves nothing over it. */
  dismiss(): void {
    if (this.takeOffer()) this.key = null;
  }

  private takeOffer(): KeyedReview | null {
    const found = this.offered;
    if (found) this.host.set({ resumeOffer: null });
    this.offered = null;
    return found;
  }

  private async resumeFrom({ key, review }: KeyedReview): Promise<void> {
    const { host } = this;
    const loaded = host.loaded();
    const documentId = this.documentId;
    if (!loaded || documentId === null) return;
    const snap = review.snapshot;
    // The goal, variant and dismissed rules change only once the restore has worked.
    const settings = withReviewPreset(host.state().settings, snap.preset, snap.depth);
    host.set({ checking: true });
    try {
      const options = checkOptions(settings, snap.variantOverride, snap.documentIgnoredRules, loaded.adapter.language);
      const { session, restored, rechecked } = await restore(loaded.paras, snap, options, { linter: await host.linter(), now: host.now });
      if (this.documentId !== documentId) return;
      if (settings !== host.state().settings) host.storeSettings(settings);
      host.set({ variantOverride: snap.variantOverride, documentIgnoredRules: [...snap.documentIgnoredRules] });
      // Counted as the prompt counts (a rejection of several places is one decision): the saved count when
      // every flag came back, else no more than the flags that did.
      const decisions = restored === snap.decisions.length ? review.made : Math.min(review.made, restored);
      host.tally.reset();
      host.tally.made(decisions);
      host.showSession(session);
      if (decisions > 0) host.markUnsaved();
      host.announce(msg('resume.done', { restored: decisions, rechecked }));
    } catch (e) {
      host.set({ error: explain(msg('error.resume'), e, msg('error.resumeNext')), checking: false });
      return;
    }
    // A changed file's review moves to the new fingerprint at once, so it is never only half there.
    if (key === this.key) return;
    await this.write();
    await savedReviews.runStoreChange(this.list!, () => this.store!.delete(key));
  }

  // ---- autosave ------------------------------------------------------------

  /** The review changed: saves it once it has rested for AUTOSAVE_DELAY_MS. */
  changed(): void {
    if (!this.key || this.offered || !this.enabled()) return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.write();
    }, AUTOSAVE_DELAY_MS);
  }

  /**
   * Saves a waiting change now (before closing or opening another document) and waits for every write.
   * False when a write failed (it is shown); true when there was nothing left to write.
   */
  async flush(): Promise<boolean> {
    if (this.timer) {
      this.cancelTimer();
      return this.write();
    }
    return this.writesInFlight > 0 ? this.writing : true;
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private write(): Promise<boolean> {
    this.writesInFlight++;
    this.writing = this.writing.then(() => this.save()).finally(() => this.writesInFlight--);
    return this.writing;
  }

  private async save(): Promise<boolean> {
    const { session, document, settings, variantOverride, documentIgnoredRules } = this.host.state();
    const key = this.key;
    if (!this.store || !key || !session || !document || !this.enabled()) return true;
    const made = this.host.tally.decided;
    try {
      const review: SavedReview = {
        name: document.name,
        path: document.path,
        updated: (this.host.now?.() ?? new Date()).toISOString(),
        made,
        left: progressOf(session, made).left,
        snapshot: await snapshot(session, { preset: settings.preset, variantOverride, documentIgnoredRules }),
      };
      // Only pasted text is ever stored, and only with the opt-in (a pasted review has no key without it).
      if (document.path === null) review.text = document.text;
      await this.store.save(key, review);
    } catch (e) {
      this.host.set({ error: explain(msg('error.reviewSave'), e, msg('error.reviewSaveNext')) });
      return false;
    }
    await savedReviews.refresh(this.list!);
    return true;
  }

  // ---- recent list and settings (savedReviewsActions) ----------------------

  // Without a store (a controller built without session files) there is nothing to list or delete.

  async startUp(): Promise<void> {
    if (this.list) await savedReviews.startUp(this.list);
  }

  async refresh(): Promise<void> {
    if (this.list) await savedReviews.refresh(this.list);
  }

  async openRecent(recent: RecentReview): Promise<void> {
    if (this.list) await savedReviews.openRecent(this.list, recent);
  }

  async deleteAll(): Promise<void> {
    if (this.list) await savedReviews.deleteAll(this.list);
  }

  async setRetention(days: number): Promise<void> {
    if (this.list) await savedReviews.setRetention(this.list, days);
    else this.host.storeSettings({ ...this.host.state().settings, sessionRetentionDays: days });
  }

  async setKeepPastedText(on: boolean): Promise<void> {
    if (this.list) await savedReviews.setKeepPastedText(this.list, on);
    else this.host.storeSettings({ ...this.host.state().settings, keepPastedText: on });
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
