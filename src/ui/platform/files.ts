import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import type { Files, OpenedFile } from '../state/sessionController';

const OPEN_FILTERS = [{ name: 'Documents', extensions: ['docx', 'txt', 'md', 'markdown'] }];

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
  async open() {
    const path = await open({ multiple: false, directory: false, filters: OPEN_FILTERS });
    return path === null ? null : readChosen(path);
  },

  async save(path, bytes, { overwrite }) {
    if (overwrite) {
      // The backup is a sibling the webview may not write, so the Rust shell makes it (lib.rs).
      await invoke<string>('backup_file', { path });
      await writeFile(path, bytes);
      return path;
    }
    const ext = extension(path);
    const chosen = await save({ defaultPath: path, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
    if (chosen === null) return null;
    await writeFile(chosen, bytes);
    return chosen;
  },
};

/** Calls `onFile` with the first file dropped on the window. Returns the unsubscribe function. */
export async function onFileDrop(onFile: (file: OpenedFile) => void, onError: (e: unknown) => void): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== 'drop' || event.payload.paths.length === 0) return;
    readChosen(event.payload.paths[0]).then(onFile, onError);
  });
}
