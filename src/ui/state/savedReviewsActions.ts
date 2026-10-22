import { msg, type Message } from '../i18n/message';
import { explain } from './errors';
import type { Files } from './saveFlow';
import type { ControllerState } from './sessionController';
import type { Opener } from './sessionPersistence';
import type { KeyedReview, RecentReview, SessionStore } from './sessionStore';
import type { Settings } from './settings';

/** What the Recent reviews list and Settings › Saved reviews need from SessionPersistence. */
export interface SavedReviewsHost {
  state(): ControllerState;
  set(patch: Partial<ControllerState>): void;
  storeSettings(settings: Settings): void;
  announce(message: Message): void;
  files: Files;
  opener: Opener;
  store: SessionStore;
  /** Saved reviews on (module switch) and kept (retention above 0). */
  enabled(): boolean;
  /** Resumes `picked` without asking once its document opens; null forgets an earlier pick. */
  pick(picked: KeyedReview | null): void;
  /** Stops saving the open document's review: a waiting autosave is dropped and later changes aren't saved. */
  stopSaving(): Promise<void>;
}

const readError = (host: SavedReviewsHost, cause: unknown) =>
  host.set({ error: explain(msg('error.reviewsRead'), cause, msg('error.reviewsReadNext')) });

/** At start-up: deletes reviews past the retention, then lists the rest and reports any file that can't be read. */
export async function startUp(host: SavedReviewsHost): Promise<void> {
  try {
    await host.store.prune(host.state().settings.sessionRetentionDays);
  } catch (e) {
    readError(host, e);
  }
  await refresh(host, true);
}

/**
 * Re-reads the Recent reviews list (empty while saving is off). With `report`, files that could not be read are
 * shown; otherwise they would come back after every autosave.
 */
export async function refresh(host: SavedReviewsHost, report = false): Promise<void> {
  if (!host.enabled()) {
    host.set({ recentReviews: [] });
    return;
  }
  try {
    const { reviews, problems } = await host.store.list();
    host.set({ recentReviews: reviews });
    if (report && problems.length > 0) readError(host, problems.join('; '));
  } catch (e) {
    readError(host, e);
  }
}

/** Recent reviews › a row: pasted text reopens from its saved text; a file through the Open dialog at its path. */
export async function openRecent(host: SavedReviewsHost, recent: RecentReview): Promise<void> {
  let review;
  try {
    review = await host.store.load(recent.key);
  } catch (e) {
    readError(host, e);
    return;
  }
  if (!review) return refresh(host);
  try {
    if (review.path === null) {
      if (review.text === undefined) return;
      host.pick({ key: recent.key, review });
      await host.opener.openText(review.text);
      return;
    }
    const file = await host.files.open(review.path);
    if (!file) return;
    host.pick({ key: recent.key, review });
    await host.opener.openFile(file);
  } finally {
    host.pick(null); // taken by the document that opened, or the open failed: never left for a later one
  }
}

/** Settings › Delete all saved reviews (after the confirmation): the open document's review is not recreated either. */
export async function deleteAll(host: SavedReviewsHost): Promise<void> {
  await host.stopSaving();
  await runStoreChange(host, () => host.store.prune(0));
  host.announce(msg('reviews.deleted'));
}

/** Settings › Keep saved reviews for: a shorter time deletes what is now too old. */
export async function setRetention(host: SavedReviewsHost, days: number): Promise<void> {
  host.storeSettings({ ...host.state().settings, sessionRetentionDays: days });
  await runStoreChange(host, () => host.store.prune(days));
}

/** Settings › Keep pasted text for resuming: off deletes the pasted text already kept. */
export async function setKeepPastedText(host: SavedReviewsHost, on: boolean): Promise<void> {
  host.storeSettings({ ...host.state().settings, keepPastedText: on });
  if (on) return;
  if (host.state().document?.path === null) await host.stopSaving();
  await runStoreChange(host, async () => {
    for (const review of (await host.store.list()).reviews) if (review.path === null) await host.store.delete(review.key);
  });
}

/** Runs a deletion, shows a failure, and re-reads the list either way. */
export async function runStoreChange(host: SavedReviewsHost, change: () => Promise<void>): Promise<void> {
  try {
    await change();
  } catch (e) {
    host.set({ error: explain(msg('error.reviewsDelete'), e, msg('error.reviewsDeleteNext')) });
  }
  await refresh(host);
}
