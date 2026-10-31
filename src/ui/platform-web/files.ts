import type * as desktop from '../platform/files';
import { SaveOverOriginalError, type Files, type OpenedFile } from '../state/saveFlow';

export type DroppedFile = desktop.DroppedFile;

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ANY_FILE = 'application/octet-stream';

/** The media type the pickers and downloads give each extension Kashiro writes. */
const MEDIA_TYPES: Record<string, string> = { docx: WORD, txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown' };

/** What Open offers: the file input's `accept`, and the open picker's filter by media type. */
const OPEN_EXTENSIONS = ['.docx', '.txt', '.md', '.markdown'];
const OPEN_ACCEPT = { [WORD]: ['.docx'], 'text/plain': ['.txt'], 'text/markdown': ['.md', '.markdown'] };

/** How long a download's blob is kept: Firefox reads it after the click returns (FileSaver.js keeps it 40 s). */
const DOWNLOAD_BLOB_MS = 40_000;

/** The File System Access pickers (Chrome, Edge); TypeScript's DOM types don't have them yet. */
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface SaveHandle {
  name: string;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}
interface Pickers {
  showOpenFilePicker?(options: { types: PickerType[]; multiple: false }): Promise<{ getFile(): Promise<File> }[]>;
  showSaveFilePicker?(options: { suggestedName: string; types: PickerType[] }): Promise<SaveHandle>;
}
const pickers = () => window as Window & Pickers;

/** The Open dialog's filter name ("Documents") in the UI language; the app sets it when the language changes. */
let documentsLabel = 'Documents';

export const setDialogLabels: typeof desktop.setDialogLabels = ({ documents }) => {
  documentsLabel = documents;
};

const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
const extension = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** The user closed a picker without choosing. */
const isCancel = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** On the web a file has no path the page may know: its name stands in, which keys its saved review (web plan). */
async function opened(file: File): Promise<OpenedFile> {
  return { name: file.name, path: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** The file the user picks with the open picker, or null when they cancel. */
async function pickWithOpenPicker(showOpenFilePicker: NonNullable<Pickers['showOpenFilePicker']>): Promise<File | null> {
  try {
    const [handle] = await showOpenFilePicker({ types: [{ description: documentsLabel, accept: OPEN_ACCEPT }], multiple: false });
    return await handle.getFile();
  } catch (e) {
    if (isCancel(e)) return null;
    throw e;
  }
}

/** The file the user picks with a file input (Firefox, Safari), or null when they cancel. */
function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = OPEN_EXTENSIONS.join(',');
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Saves `bytes` as a download named `name` (browsers without the save picker). */
function download(bytes: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_BLOB_MS);
}

export const files = {
  // `defaultPath` (a saved review's file) is only a name on the web: the user picks the file again.
  async open(_defaultPath?: string) {
    const { showOpenFilePicker } = pickers();
    const file = showOpenFilePicker ? await pickWithOpenPicker(showOpenFilePicker.bind(window)) : await pickWithInput();
    return file ? opened(file) : null;
  },

  /**
   * `path` is the name saveFlow suggests: the `.checked` copy, or with Overwrite the original's name (after the
   * "No backup on the web" notice). A browser keeps no backup, and the user confirms its own "Replace?" prompt.
   */
  async save(path, bytes, { overwrite, original }) {
    const suggestedName = fileName(path);
    const ext = extension(suggestedName);
    const type = MEDIA_TYPES[ext] ?? ANY_FILE;
    const { showSaveFilePicker } = pickers();
    if (!showSaveFilePicker) {
      download(bytes, suggestedName, type);
      return { path: suggestedName, backup: null };
    }
    let handle: SaveHandle;
    try {
      handle = await showSaveFilePicker.call(window, { suggestedName, types: ext ? [{ description: ext.toUpperCase(), accept: { [type]: [`.${ext}`] } }] : [] });
    } catch (e) {
      if (isCancel(e)) return null;
      throw e;
    }
    // Only a name to compare: the browser doesn't say which folder either file is in (spec: matched by name).
    if (!overwrite && original && handle.name.toLowerCase() === fileName(original).toLowerCase()) throw new SaveOverOriginalError(handle.name);
    // The browser writes to a temporary file and moves it into place on close: the whole file or nothing.
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return { path: handle.name, backup: null };
  },
} satisfies Files;

/** Subscribes `listener` to drops on the page, in the capture phase (`capture`) or as the drop bubbles up. */
function listenForDrops(listener: (event: DragEvent) => void, capture: boolean): () => void {
  // Without this the browser opens a dropped file itself, leaving Kashiro.
  const allowDrop = (event: DragEvent) => event.preventDefault();
  window.addEventListener('dragover', allowDrop);
  window.addEventListener('drop', listener, { capture });
  return () => {
    window.removeEventListener('dragover', allowDrop);
    window.removeEventListener('drop', listener, { capture });
  };
}

/**
 * Calls `onDrop` with the files dropped on the page, in order. Returns the unsubscribe function. Caught before the
 * page sees them, so the editor never inserts a dropped file's text.
 */
export const onFileDrop: typeof desktop.onFileDrop = async (onDrop) =>
  listenForDrops((event) => {
    const dropped = [...(event.dataTransfer?.files ?? [])];
    if (dropped.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    onDrop(dropped.map((file) => ({ name: file.name, read: () => opened(file) })));
  }, true);

/**
 * Calls `onDrop` with plain text dropped on the page (dragged from another app or tab). Text the editor took
 * itself, moved inside the document, is left to it. Returns the unsubscribe function.
 */
export const onTextDrop: typeof desktop.onTextDrop = async (onDrop) =>
  listenForDrops((event) => {
    if (event.defaultPrevented || !event.dataTransfer || event.dataTransfer.files.length > 0) return;
    const text = event.dataTransfer.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    onDrop(text);
  }, false);
