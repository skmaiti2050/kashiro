/**
 * "Save a copy" (platform/files.ts, review #4): the copy goes through Rust's temp-and-rename save_copy, never
 * the webview's own writeFile, and a copy chosen over the open document is refused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  save: vi.fn(async (): Promise<string | null> => null),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: tauri.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(), writeFile: tauri.writeFile }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: vi.fn() }));

const { files, onFileDrop, onTextDrop } = await import('@/ui/platform/files');
const { getCurrentWebview } = await import('@tauri-apps/api/webview');
const { readFile } = await import('@tauri-apps/plugin-fs');
type DroppedFile = import('@/ui/platform/files').DroppedFile;
const { SaveOverOriginalError } = await import('@/ui/state/saveFlow');

const BYTES = new Uint8Array([1, 2, 3]);
const ORIGINAL = 'C:\\Docs\\essay.docx';

beforeEach(() => vi.clearAllMocks());

describe('Save a copy', () => {
  it('writes the chosen file through save_copy, with the open document named for Rust to refuse', async () => {
    tauri.save.mockResolvedValueOnce('C:\\Docs\\essay.checked.docx');
    expect(await files.save('C:\\Docs\\essay.checked.docx', BYTES, { overwrite: false, original: ORIGINAL })).toEqual({
      path: 'C:\\Docs\\essay.checked.docx',
      backup: null,
    });
    expect(tauri.invoke).toHaveBeenCalledWith('save_copy', BYTES, {
      headers: { path: encodeURIComponent('C:\\Docs\\essay.checked.docx'), original: encodeURIComponent(ORIGINAL) },
    });
    expect(tauri.writeFile).not.toHaveBeenCalled();
  });

  it('refuses the open document itself, whatever the case or slashes, and writes nothing', async () => {
    tauri.save.mockResolvedValueOnce('c:/docs/ESSAY.docx');
    await expect(files.save('C:\\Docs\\essay.checked.docx', BYTES, { overwrite: false, original: ORIGINAL })).rejects.toBeInstanceOf(
      SaveOverOriginalError,
    );
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(tauri.writeFile).not.toHaveBeenCalled();
  });

  it('pasted text has no original: the copy is written without one', async () => {
    tauri.save.mockResolvedValueOnce('C:\\Docs\\Untitled.checked.txt');
    await files.save('Untitled.checked.txt', BYTES, { overwrite: false, original: null });
    expect(tauri.invoke).toHaveBeenCalledWith('save_copy', BYTES, { headers: { path: encodeURIComponent('C:\\Docs\\Untitled.checked.txt') } });
  });

  it('a cancelled dialog writes nothing', async () => {
    expect(await files.save('C:\\Docs\\essay.checked.docx', BYTES, { overwrite: false, original: ORIGINAL })).toBeNull();
    expect(tauri.invoke).not.toHaveBeenCalled();
  });
});

describe('a file dropped on the window (Task F21b item 9)', () => {
  it('gives every dropped file’s name at once, and reads one only when asked', async () => {
    let onEvent: ((event: { payload: { type: string; paths?: string[] } }) => void) | null = null;
    vi.mocked(getCurrentWebview).mockReturnValue({
      onDragDropEvent: async (handler: typeof onEvent) => {
        onEvent = handler;
        return () => {};
      },
    } as never);
    vi.mocked(readFile).mockResolvedValue(BYTES);
    const seen: DroppedFile[][] = [];
    await onFileDrop((dropped) => seen.push(dropped));

    onEvent!({ payload: { type: 'over' } });
    onEvent!({ payload: { type: 'drop', paths: ['C:\\Docs\\photo.png', 'C:\\Docs\\notes.md'] } });
    expect(seen.map((d) => d.map((f) => f.name))).toEqual([['photo.png', 'notes.md']]);
    expect(readFile).not.toHaveBeenCalled();
    expect(await seen[0][1].read()).toEqual({ name: 'notes.md', path: 'C:\\Docs\\notes.md', bytes: BYTES });
  });

  it('text never reaches the page under Tauri: onTextDrop subscribes to nothing and unsubscribes cleanly (Web Task 3)', async () => {
    const stop = await onTextDrop(() => {
      throw new Error('no text drop on desktop');
    });
    expect(getCurrentWebview).not.toHaveBeenCalled();
    expect(stop()).toBeUndefined();
  });
});
