import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import type { Files, OpenedFile } from '../state/sessionController';
import { isSamePath, SaveOverOriginalError } from '../state/saveFlow';

const OPEN_EXTENSIONS = ['docx', 'txt', 'md', 'markdown'];

/** The Open dialog's filter name ("Documents") in the UI language; the app sets it when the language changes. */
let documentsLabel = 'Documents';

export function setDialogLabels({ documents }: { documents: string }): void {
  documentsLabel = documents;
}

const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
const extension = (path: string) => {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
};

/**
 * Reads a file the user chose. The fs scope holds only such files: the dialog plugin adds each picked
 * path, and the fs plugin adds dropped paths.
 */
async function readChosen(path: string): Promise<OpenedFile> {
  return { name: fileName(path), path, bytes: await readFile(path) };
}

export const files: Files = {
  async open(defaultPath) {
    // A saved review's file is reopened through the dialog too: only a file the user picks enters the fs scope.
    const path = await open({ multiple: false, directory: false, defaultPath, filters: [{ name: documentsLabel, extensions: OPEN_EXTENSIONS }] });
    return path === null ? null : readChosen(path);
  },

  async save(path, bytes, { overwrite, original }) {
    if (overwrite) {
      // Rust backs the file up, writes a temporary sibling and renames it over the original (lib.rs):
      // the webview may write neither sibling, and a failure must not leave the original half-written.
      // Raw binary IPC body (no JSON number array); header values must be ASCII, so the path is URI-encoded.
      const backup = await invoke<string>('overwrite_with_backup', bytes, { headers: { path: encodeURIComponent(path) } });
      return { path, backup };
    }
    const ext = extension(path);
    const chosen = await save({ defaultPath: path, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
    if (chosen === null) return null;
    if (original && isSamePath(chosen, original)) throw new SaveOverOriginalError(chosen);
    // Rust writes a temporary sibling and renames it into place, and refuses the original too (lib.rs save_copy).
    const headers: Record<string, string> = { path: encodeURIComponent(chosen) };
    if (original) headers.original = encodeURIComponent(original);
    await invoke<void>('save_copy', bytes, { headers });
    return { path: chosen, backup: null };
  },
};

/** Calls `onFile` with the first file dropped on the window. Returns the unsubscribe function. */
export async function onFileDrop(onFile: (file: OpenedFile) => void, onError: (e: unknown) => void): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== 'drop' || event.payload.paths.length === 0) return;
    readChosen(event.payload.paths[0]).then(onFile, onError);
  });
}
