// @vitest-environment jsdom
// Web Task 3: files in the browser. Open uses the open picker (or a file input), Save the save picker (or a download)
// with the name desktop suggests, a copy over the open document is refused as on desktop, and files or text dropped
// on the page reach the app. On the web a file's path is its name: that is what saved reviews are keyed by.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { files, onFileDrop, onTextDrop, type DroppedFile } from '@/ui/platform-web/files';
import { SaveOverOriginalError } from '@/ui/state/saveFlow';

const BYTES = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);

/** What a fake save picker was asked for and what was written through it. */
interface SavePickerCall {
  suggestedName: string;
  types: unknown[];
  written: Uint8Array | null;
}

/** A save picker where the user picks `pickedName` (null: they cancel); `calls` records each use. */
function installSavePicker(pickedName: string | null) {
  const calls: SavePickerCall[] = [];
  const picker = vi.fn(async ({ suggestedName, types }: { suggestedName: string; types: unknown[] }) => {
    const call: SavePickerCall = { suggestedName, types, written: null };
    calls.push(call);
    if (pickedName === null) throw new DOMException('The user aborted a request.', 'AbortError');
    return {
      name: pickedName,
      createWritable: async () => ({
        write: async (data: Uint8Array) => {
          call.written = new Uint8Array(data);
        },
        close: async () => {},
      }),
    };
  });
  Object.defineProperty(window, 'showSaveFilePicker', { value: picker, configurable: true });
  return calls;
}

/** An open picker where the user picks a file named `name` holding `bytes` (null: they cancel). */
function installOpenPicker(name: string | null, bytes = BYTES) {
  const picker = vi.fn(async () => {
    if (name === null) throw new DOMException('The user aborted a request.', 'AbortError');
    return [{ getFile: async () => new File([bytes], name) }];
  });
  Object.defineProperty(window, 'showOpenFilePicker', { value: picker, configurable: true });
  return picker;
}

/** A drop on the page carrying `files` and/or plain `text`, as the browser fires it. */
function dropEvent({ files: dropped = [], text = '' }: { files?: File[]; text?: string }): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  const dataTransfer = { files: dropped, getData: (type: string) => (type === 'text/plain' ? text : '') };
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

afterEach(() => {
  delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Save with the save picker (Chrome, Edge)', () => {
  it('a new copy: suggests report.checked.docx with a Word filter, and writes the bytes to the picked file', async () => {
    const calls = installSavePicker('report.checked.docx');
    const saved = await files.save('report.checked.docx', BYTES, { overwrite: false, original: 'report.docx' });
    expect(saved).toEqual({ path: 'report.checked.docx', backup: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].suggestedName).toBe('report.checked.docx');
    expect(calls[0].types).toEqual([
      { description: 'DOCX', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } },
    ]);
    expect(calls[0].written).toEqual(BYTES);
  });

  it('Overwrite: suggests the original name, report.docx, and keeps no backup', async () => {
    const calls = installSavePicker('report.docx');
    const saved = await files.save('report.docx', BYTES, { overwrite: true, original: 'report.docx' });
    expect(saved).toEqual({ path: 'report.docx', backup: null });
    expect(calls[0].suggestedName).toBe('report.docx');
    expect(calls[0].written).toEqual(BYTES);
  });

  it('a copy picked over the open document (any case) is refused and nothing is written', async () => {
    const calls = installSavePicker('REPORT.docx');
    await expect(files.save('report.checked.docx', BYTES, { overwrite: false, original: 'report.docx' })).rejects.toBeInstanceOf(
      SaveOverOriginalError,
    );
    expect(calls[0].written).toBeNull();
  });

  it('pasted text has no original: any name is fine', async () => {
    const calls = installSavePicker('Untitled.txt');
    expect(await files.save('Untitled.checked.txt', BYTES, { overwrite: false, original: null })).toEqual({ path: 'Untitled.txt', backup: null });
    expect(calls[0].types).toEqual([{ description: 'TXT', accept: { 'text/plain': ['.txt'] } }]);
  });

  it('a cancelled picker writes nothing and returns null', async () => {
    const calls = installSavePicker(null);
    expect(await files.save('report.checked.docx', BYTES, { overwrite: false, original: 'report.docx' })).toBeNull();
    expect(calls[0].written).toBeNull();
  });
});

describe('Save as a download (Firefox, Safari)', () => {
  it('downloads report.checked.docx with the bytes, and frees the blob afterwards', async () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:kashiro/1';
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });

    const saved = await files.save('report.checked.docx', BYTES, { overwrite: false, original: 'report.docx' });

    expect(saved).toEqual({ path: 'report.checked.docx', backup: null });
    expect(clicked).toHaveLength(1);
    expect(clicked[0].getAttribute('download')).toBe('report.checked.docx');
    expect(clicked[0].href).toBe('blob:kashiro/1');
    expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(BYTES);
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:kashiro/1');
  });
});

describe('Open', () => {
  it('with the open picker: the file’s name is also its path', async () => {
    const picker = installOpenPicker('a.docx');
    expect(await files.open()).toEqual({ name: 'a.docx', path: 'a.docx', bytes: BYTES });
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it('a saved review’s file is picked again (the path given is only a name on the web)', async () => {
    installOpenPicker('a.docx');
    expect(await files.open('a.docx')).toEqual({ name: 'a.docx', path: 'a.docx', bytes: BYTES });
  });

  it('a cancelled open picker returns null', async () => {
    installOpenPicker(null);
    expect(await files.open()).toBeNull();
  });

  it('without the open picker: a file input for .docx, .txt and .md, and the chosen file', async () => {
    let input: HTMLInputElement | null = null;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      input = this;
    });
    const opening = files.open();
    await vi.waitFor(() => expect(input).not.toBeNull());
    expect(input!.type).toBe('file');
    expect(input!.accept).toBe('.docx,.txt,.md,.markdown');
    Object.defineProperty(input!, 'files', { value: [new File([BYTES], 'notes.md')] });
    input!.dispatchEvent(new Event('change'));
    expect(await opening).toEqual({ name: 'notes.md', path: 'notes.md', bytes: BYTES });
  });

  it('without the open picker: a cancelled file input returns null', async () => {
    let input: HTMLInputElement | null = null;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      input = this;
    });
    const opening = files.open();
    await vi.waitFor(() => expect(input).not.toBeNull());
    input!.dispatchEvent(new Event('cancel'));
    expect(await opening).toBeNull();
  });
});

describe('dropping on the page', () => {
  it('files: every name at once, the bytes only when read, the name as the path; the browser doesn’t open them', async () => {
    const seen: DroppedFile[][] = [];
    const texts: string[] = [];
    const stopFiles = await onFileDrop((dropped) => seen.push(dropped));
    const stopText = await onTextDrop((text) => texts.push(text));

    const over = new Event('dragover', { bubbles: true, cancelable: true });
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = dropEvent({ files: [new File([BYTES], 'photo.png'), new File([BYTES], 'notes.md')], text: 'C:\\fakepath\\notes.md' });
    document.body.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
    expect(seen.map((d) => d.map((f) => f.name))).toEqual([['photo.png', 'notes.md']]);
    expect(texts).toEqual([]);
    expect(await seen[0][1].read()).toEqual({ name: 'notes.md', path: 'notes.md', bytes: BYTES });
    stopFiles();
    stopText();
  });

  it('text: goes to onTextDrop, not onFileDrop', async () => {
    const seen: DroppedFile[][] = [];
    const texts: string[] = [];
    const stopFiles = await onFileDrop((dropped) => seen.push(dropped));
    const stopText = await onTextDrop((text) => texts.push(text));
    const drop = dropEvent({ text: 'The cat sat on the mat.' });
    document.body.dispatchEvent(drop);
    expect(texts).toEqual(['The cat sat on the mat.']);
    expect(seen).toEqual([]);
    expect(drop.defaultPrevented).toBe(true);
    stopFiles();
    stopText();
  });

  it('text the editor already took (moved inside the document) is not opened again', async () => {
    const texts: string[] = [];
    const stop = await onTextDrop((text) => texts.push(text));
    const drop = dropEvent({ text: 'moved words' });
    document.body.addEventListener('drop', (e) => e.preventDefault(), { once: true });
    document.body.dispatchEvent(drop);
    expect(texts).toEqual([]);
    stop();
  });

  it('after unsubscribing, drops reach nobody', async () => {
    const texts: string[] = [];
    const seen: DroppedFile[][] = [];
    (await onTextDrop((text) => texts.push(text)))();
    (await onFileDrop((dropped) => seen.push(dropped)))();
    document.body.dispatchEvent(dropEvent({ text: 'hello' }));
    document.body.dispatchEvent(dropEvent({ files: [new File([BYTES], 'a.txt')] }));
    expect(texts).toEqual([]);
    expect(seen).toEqual([]);
  });
});
