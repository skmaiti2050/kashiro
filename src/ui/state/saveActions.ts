import { msg, type Message } from '../i18n/message';
import { sameParagraphs } from './documentText';
import { explain } from './errors';
import type { LoadedFile } from './openDocument';
import { SaveOverOriginalError, saveDocument, saveReport, type Files } from './saveFlow';
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
  /** A count that moves with every edit, decision or typed text in the open document. */
  changes(): number;
  /** The document on disk now matches the review as it was at `changes`: later changes stay unsaved. */
  markSaved(changes: number): void;
}

const SAVE_AGAIN = msg('error.saveAgain');
const NOT_CHECKED = msg('error.saveNotChecked');

/**
 * Writes the document with the accepted edits: a tracked or clean copy, or over the file after a
 * backup. Returns true when the file was written (false when cancelled or failed).
 */
export async function save(host: SaveHost): Promise<boolean> {
  // Counted before the typed text is flushed: typing or decisions that come later may miss the file, so they stay unsaved.
  const changes = host.changes();
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
    host.markSaved(changes);
    return true;
  } catch (e) {
    host.set({ error: saveError(e, msg('error.save', { name: document.name }), document.name) });
    return false;
  }
}

/** What to say when a save failed: a copy refused over the open document has its own message. */
function saveError(e: unknown, what: Message, name: string): Message {
  return e instanceof SaveOverOriginalError ? msg('error.saveOverOriginal', { name }) : explain(what, e, SAVE_AGAIN);
}

/** Saves the change report (Markdown) beside the document. The document itself still counts as unsaved. */
export async function exportReport(host: SaveHost): Promise<void> {
  await host.flush();
  const { session, document } = host.state();
  if (!session || !document) return;
  try {
    host.set({ notice: await saveReport(session, document.name, document.path, host.files), error: null });
  } catch (e) {
    host.set({ error: saveError(e, msg('error.saveReport'), document.name) });
  }
}
