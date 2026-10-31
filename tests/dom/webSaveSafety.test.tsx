// Final review R1 and R2: what Save says on the web. A file picked over the open document is written (the browser's
// "Replace?" already emptied it) and the notice says the original was replaced; a write that fails after the picker
// warns the file may be empty. Without the save picker (Firefox, Safari) Save downloads a copy, says "Downloaded as",
// never offers Overwrite, and the work stays unsaved so the leave prompt still protects it.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Capabilities } from '@/ui/platform/capabilities';
import { files as webFiles } from '@/ui/platform-web/files';
import { msg, type Message } from '@/ui/i18n/message';
import { createTranslator } from '@/ui/i18n/translator';
import { buildDocx } from '../fixtures/make_docx';
import { makeController, warmLinter } from './harness';

const PICKER: Capabilities = { ai: false, windowMemory: false, updates: false, textDrop: true, saveInPlace: 'picker', web: true };
const DOWNLOAD: Capabilities = { ...PICKER, saveInPlace: 'download' };
const platform = vi.hoisted(() => ({ capabilities: {} as Capabilities }));
vi.mock('@/ui/platform/capabilities', () => platform);

const english = createTranslator('en', ['en-US']);
const reportDocx = () => buildDocx('<w:p><w:r><w:t>She recieved the letter yesterday.</w:t></w:r></w:p>');

/** Open's file input picks report.docx. */
async function installOpenInput() {
  const bytes = await reportDocx();
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    Object.defineProperty(this, 'files', { value: [new File([bytes.slice()], 'report.docx')] });
    this.dispatchEvent(new Event('change'));
  });
}

/** Open picks report.docx; the save picker returns `pickedName`, and `write` runs for its bytes. */
async function installPickers(pickedName: string, write: (data: Uint8Array) => Promise<void> = async () => {}) {
  await installOpenInput();
  const save = async () => ({ name: pickedName, createWritable: async () => ({ write, close: async () => {} }) });
  Object.defineProperty(window, 'showSaveFilePicker', { value: save, configurable: true });
}

/** Open's file input picks report.docx; downloads are caught in `downloaded` (names). */
async function installDownloads() {
  await installOpenInput();
  const downloaded: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloaded.push(this.download);
  });
  Object.assign(URL, { createObjectURL: () => 'blob:kashiro/1', revokeObjectURL: () => {} });
  return downloaded;
}

/** A web controller with report.docx open and its one suggestion accepted. */
async function reviewed(settings: { overwrite?: boolean } = {}) {
  const { controller } = makeController({ saveMode: 'clean', ...settings }, webFiles);
  await controller.open();
  controller.accept(controller.getState().session!.decisions().top[0].id);
  return controller;
}

const text = (message: Message | null) => (message ? english.format(message) : null);

beforeAll(warmLinter);

afterEach(() => {
  delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  vi.restoreAllMocks();
});

describe('with the save picker', () => {
  it('the open document picked without Overwrite is written, and the notice says it was replaced', async () => {
    platform.capabilities = PICKER;
    await installPickers('report.docx');
    const controller = await reviewed();
    expect(await controller.save()).toBe(true);
    expect(controller.getState().notice).toEqual(msg('save.webReplacedOriginal', { name: 'report.docx' }));
    expect(text(controller.getState().notice)).toBe('You replaced report.docx with the checked version.');
    expect(controller.hasUnsavedWork()).toBe(false);
  });

  it('a write that fails after the picker says the chosen file may be empty and to save again', async () => {
    platform.capabilities = PICKER;
    await installPickers('report.checked.docx', async () => {
      throw new Error('The disk is full.');
    });
    const controller = await reviewed();
    expect(await controller.save()).toBe(false);
    expect(text(controller.getState().error)).toBe(
      'Couldn’t save report.checked.docx: The disk is full. report.checked.docx may now be empty. Save again before you close this page.',
    );
    expect(controller.hasUnsavedWork()).toBe(true);
  });
});

describe('without the save picker (a download)', () => {
  it('says "Downloaded as", not "Saved as", and the work stays unsaved', async () => {
    platform.capabilities = DOWNLOAD;
    const downloaded = await installDownloads();
    const controller = await reviewed();
    expect(await controller.save()).toBe(true);
    expect(downloaded).toEqual(['report.checked.docx']);
    expect(text(controller.getState().notice)).toBe('Downloaded as report.checked.docx. Check your Downloads folder.');
    expect(controller.hasUnsavedWork()).toBe(true);
  });

  it('Overwrite left on in the settings still downloads a copy, with no "No backup" notice', async () => {
    platform.capabilities = DOWNLOAD;
    const downloaded = await installDownloads();
    const controller = await reviewed({ overwrite: true });
    const notices: (Message | null)[] = [];
    const stop = controller.subscribe(() => notices.push(controller.getState().notice));
    expect(await controller.save()).toBe(true);
    stop();
    expect(downloaded).toEqual(['report.checked.docx']);
    expect(notices).not.toContainEqual(msg('save.webNoBackup'));
  });
});
