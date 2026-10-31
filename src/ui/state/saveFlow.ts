import type { Edit } from '@/engine/session';
import type { CheckSession } from '@/engine/session';
import { exportReport } from '@/engine/report';
import type { FormatAdapter } from '@/formats/types';
import { msg, type Message } from '../i18n/message';
import { capabilities } from '../platform/capabilities';
import { siblingPath } from './documentText';
import type { Settings } from './settings';

export interface OpenedFile {
  name: string;
  /** Null when the bytes came without a path (nothing to overwrite). */
  path: string | null;
  bytes: Uint8Array;
}

/** Where a save went; `backup` is set when the original was overwritten. */
export interface SavedFile {
  path: string;
  backup: string | null;
}

/** File access (platform/files.ts in the app, an in-memory fake in tests). */
export interface Files {
  /** Asks the user for a file, starting at `defaultPath` when given; null when they cancel. */
  open(defaultPath?: string): Promise<OpenedFile | null>;
  /**
   * Writes `bytes`. With `overwrite`, backs `path` up first (`name.bak.ext`) and replaces it whole;
   * otherwise lets the user confirm or change the suggested `path`, writes the copy whole or not at all, and
   * throws SaveOverOriginalError when the chosen file is `original` (the open document). Null when the user cancelled.
   * The web differs (final review R1): its picker's "Replace?" has already emptied the chosen file, so it always
   * writes, and a failed write throws ChosenFileMayBeEmptyError.
   */
  save(path: string, bytes: Uint8Array, opts: { overwrite: boolean; original?: string | null }): Promise<SavedFile | null>;
}

/** A copy was to be saved over the open document itself (review #4): only Overwrite, after a backup, may replace it. */
export class SaveOverOriginalError extends Error {
  constructor(readonly path: string) {
    super(`${path} is the document you opened; a copy never replaces it`);
  }
}

/**
 * The web's write failed after its save picker returned: Chromium empties the chosen file as soon as the user
 * confirms "Replace?", so `path` may now be empty (final review R1). The message is the browser's reason.
 */
export class ChosenFileMayBeEmptyError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    // A DOMException is an Error in browsers but not in every test DOM.
    super(cause instanceof Error || cause instanceof DOMException ? cause.message : String(cause), { cause });
  }
}

/** Windows paths name the same file whatever their case or slashes: "C:\\Docs\\a.txt" = "c:/docs/A.TXT". */
export const isSamePath = (a: string, b: string): boolean => a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase();

interface SaveRequest {
  session: CheckSession;
  adapter: FormatAdapter;
  handle: unknown;
  name: string;
  path: string | null;
  settings: Settings;
  files: Files;
  /** Shows a notice while the save dialog is open (the web's "No backup on the web"). */
  notify(notice: Message): void;
}

const sameEdit = (a: Edit, b: Edit | undefined) =>
  b !== undefined && a.paraId === b.paraId && a.span.start === b.span.start && a.span.end === b.span.end && a.replacement === b.replacement;

/**
 * Writes the document with the session's accepted edits (tracked or clean; a new copy, or over the file
 * after a backup). Edits the adapter could not place are marked on the session, so the change log
 * shows them. Returns the notice for the user, or null when they cancelled the save dialog.
 */
export async function saveDocument({ session, adapter, handle, name, path, settings, files, notify }: SaveRequest): Promise<Message | null> {
  const { bytes, unplaceable } = await adapter.write(handle, session.acceptedEdits(), settings.saveMode);
  for (const { edit, reason } of unplaceable) {
    const outcome = session.outcomes().find((o) => {
      if (o.status !== 'applied') return false;
      return sameEdit(edit, { paraId: o.candidate.paraId, span: o.candidate.span, replacement: o.replacement ?? '' });
    });
    if (outcome) session.markUnplaceable(outcome.candidate.id, reason);
  }
  const overwrite = settings.overwrite && path !== null && overwriteOffered();
  const target = overwrite ? path : siblingPath(path ?? name, '.checked');
  // A browser keeps no .bak: said before its save picker opens, where the user confirms "Replace?" (web spec).
  if (overwrite && capabilities.web) notify(msg('save.webNoBackup'));
  const saved = await files.save(target, bytes, { overwrite, original: path });
  if (!saved) return null;
  const webNotice = webSavedNotice(saved.path, overwrite, path);
  if (webNotice) return unplaceable.length ? msg('notice.unplacedAfter', { saved: webNotice, count: unplaceable.length }) : webNotice;
  const notice = saved.backup ? msg('notice.savedBackup', { path: saved.path, backup: saved.backup }) : msg('notice.saved', { path: saved.path });
  return unplaceable.length ? msg('notice.savedUnplaced', { saved: notice, count: unplaceable.length }) : notice;
}

/** Overwrite needs a file to write over: a download (no save picker) only ever makes a new copy (final review R2). */
export const overwriteOffered = (): boolean => capabilities.saveInPlace !== 'download';

/**
 * The web's own save notices (final review R1, R2), or null for "Saved as": a download went to the Downloads
 * folder, and a copy picked over the open document replaced it (the browser's "Replace?" was the confirmation).
 * Only names to compare: the browser doesn't say which folder either file is in (spec: matched by name).
 */
function webSavedNotice(savedName: string, overwrite: boolean, original: string | null): Message | null {
  if (capabilities.saveInPlace === 'download') return msg('save.downloaded', { name: savedName });
  if (!capabilities.web || overwrite || original === null) return null;
  return isSamePath(savedName, fileName(original)) ? msg('save.webReplacedOriginal', { name: savedName }) : null;
}

/** The last part of a path ("C:\\Docs\\a.docx" → "a.docx"; on the web a path is only a name). */
const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/** Saves the Markdown change report beside the document. Returns the notice, or null when cancelled. */
export async function saveReport(session: CheckSession, name: string, path: string | null, files: Files): Promise<Message | null> {
  const bytes = new TextEncoder().encode(exportReport(session, name));
  const saved = await files.save(siblingPath(path ?? name, '.report', '.md'), bytes, { overwrite: false, original: path });
  if (!saved) return null;
  return capabilities.saveInPlace === 'download' ? msg('save.downloaded', { name: saved.path }) : msg('notice.report', { path: saved.path });
}
