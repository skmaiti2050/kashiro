import { msg, type Message } from '../i18n/message';
import { sameParagraphs } from './documentText';
import { explain } from './errors';
import type { LoadedFile } from './openDocument';
import { saveDocument, saveReport, type Files } from './saveFlow';
import type { ControllerState } from './sessionController';

/** What saving and exporting need from the controller. */
export interface SaveHost {
  state(): ControllerState;
  set(patch: Partial<ControllerState>): void;
  /** Checks typed text that is still waiting for its pause, so the save includes it. */
  flush(): Promise<void>;
  /** The open file's adapter and handle; null with nothing open. */
  loaded(): LoadedFile | null;
  /**
   * Why saving would lose typed text (it was too long to read for a check), or null. A session checked on
   * other text than `loaded` is refused by save() itself.
   */
  saveRefused(): Message | null;
  files: Files;
  /** The document on disk now matches the review: nothing is unsaved. */
  markSaved(): void;
}

const SAVE_AGAIN = msg('error.saveAgain');
const NOT_CHECKED = msg('error.saveNotChecked');

/**
 * Writes the document with the accepted edits: a tracked or clean copy, or over the file after a
 * backup. Returns true when the file was written (false when cancelled or failed).
 */
export async function save(host: SaveHost): Promise<boolean> {
  await host.flush();
  const { session, document, settings } = host.state();
  const loaded = host.loaded();
  if (!session || !document || !loaded) return false;
  // The edits' offsets belong to the text the session checked: written into other text, they land in the wrong places.
  const refused = host.saveRefused() ?? (sameParagraphs(session.paragraphs(), loaded.paras) ? null : NOT_CHECKED);
  if (refused) {
    host.set({ error: refused });
    return false;
  }
  const { adapter, handle } = loaded;
  try {
    const notice = await saveDocument({ session, adapter, handle, name: document.name, path: document.path, settings, files: host.files });
    // Unplaceable edits may have been marked on the session, so this always re-renders.
    host.set({ notice, error: null });
    if (notice === null) return false;
    host.markSaved();
    return true;
  } catch (e) {
    host.set({ error: explain(msg('error.save', { name: document.name }), e, SAVE_AGAIN) });
    return false;
  }
}

/** Saves the change report (Markdown) beside the document. The document itself still counts as unsaved. */
export async function exportReport(host: SaveHost): Promise<void> {
  await host.flush();
  const { session, document } = host.state();
  if (!session || !document) return;
  try {
    host.set({ notice: await saveReport(session, document.name, document.path, host.files), error: null });
  } catch (e) {
    host.set({ error: explain(msg('error.saveReport'), e, SAVE_AGAIN) });
  }
}
