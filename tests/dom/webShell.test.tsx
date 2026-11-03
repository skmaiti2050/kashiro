// Web Task 3: the app shell over the web's own files and window modules. Text dropped on the page opens as a new
// document (after the unsaved-work prompt, as Paste); a text or file Kashiro can't take says so and keeps the open
// document. Leaving the page with unsaved work makes the browser ask "Leave site?" (controller ruling 1); without
// unsaved work nothing asks, and Kashiro's own Save/Discard dialog never follows the browser's prompt. A save picker
// the browser refused (the click's activation ran out) is opened from a new click on "… is ready to save" (fix round 1).
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { msg } from '@/ui/i18n/message';
import type { Capabilities } from '@/ui/platform/capabilities';
import { files as webFiles } from '@/ui/platform-web/files';
import { makeController, warmLinter } from './harness';
import { installSpeech, LOCAL_VOICE, openAndWait, renderShell, reviewPanel } from './shell';

const platform = vi.hoisted(() => ({
  // 'picker': the save tests install showSaveFilePicker, and a browser that has it saves in place (final review R2).
  capabilities: { ai: false, windowMemory: false, updates: false, textDrop: true, saveInPlace: 'picker', web: true } satisfies Capabilities,
}));
vi.mock('@/ui/platform/capabilities', () => platform);
vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', () => import('@/ui/platform-web/files'));
vi.mock('@/ui/platform/window', () => import('@/ui/platform-web/window'));
vi.mock('@/ui/platform/speech', () => import('@/ui/platform-web/speech'));
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** Drops `files` and/or plain `text` on the page, as the browser fires it. */
function dropOnPage({ files = [], text = '' }: { files?: File[]; text?: string }): void {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, getData: (type: string) => (type === 'text/plain' ? text : '') } });
  act(() => void document.body.dispatchEvent(event));
}

async function withUnsavedWork() {
  const { controller } = makeController();
  renderShell(controller);
  await openAndWait(controller, () => controller.openText('I recieve mail today.'));
  fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
  expect(controller.hasUnsavedWork()).toBe(true);
  return controller;
}

describe('dropping text on the page', () => {
  it('opens the text as a new document', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await act(async () => {});
    dropOnPage({ text: 'The cat sat on the mat.' });
    await waitFor(() => expect(controller.getState().phase).toBe('ready'), { timeout: 10000 });
    expect(controller.getState().document).toMatchObject({ name: 'Untitled.txt', text: 'The cat sat on the mat.' });
  });

  it('with unsaved work, the prompt comes first; Discard opens the text', async () => {
    const controller = await withUnsavedWork();
    dropOnPage({ text: 'The dog sat on the rug.' });
    const dialog = screen.getByRole('alertdialog', { name: 'Unsaved changes' });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: /Discard/ })));
    await waitFor(() => expect(controller.getState().document?.text).toBe('The dog sat on the rug.'), { timeout: 10000 });
  });

  it('2.1 MB of text: the too-large notice, and the open document stays', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const before = controller.getState().document;
    dropOnPage({ text: 'a'.repeat(2_100_000) });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Untitled.txt is too large to check (2.1 MB'));
    expect(controller.getState().document).toBe(before);
  });

  it('a .pdf: the unsupported notice, and the open document stays', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const before = controller.getState().document;
    dropOnPage({ files: [new File(['%PDF-1.7'], 'brief.pdf')] });
    expect(screen.getByRole('alert').textContent).toContain('Can’t open brief.pdf: Kashiro opens .docx, .txt and .md files.');
    expect(controller.getState().document).toBe(before);
  });

  it('a .md file opens under its name, which is its path on the web', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await act(async () => {});
    dropOnPage({ files: [new File(['The cat sat on the mat.'], 'notes.md')] });
    await waitFor(() => expect(controller.getState().document).toMatchObject({ name: 'notes.md', path: 'notes.md' }), { timeout: 10000 });
  });
});

describe('Save after the browser refused its picker (the Save click was too long ago)', () => {
  /** A save picker that refuses its first call (lost user activation); `written` records each file written. */
  function installRefusingPicker() {
    const written: { name: string; bytes: Uint8Array }[] = [];
    let calls = 0;
    const picker = async ({ suggestedName }: { suggestedName: string }) => {
      if (++calls === 1) throw new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError');
      return {
        name: suggestedName,
        createWritable: async () => ({
          write: async (data: Uint8Array) => void written.push({ name: suggestedName, bytes: new Uint8Array(data) }),
          close: async () => {},
        }),
      };
    };
    Object.defineProperty(window, 'showSaveFilePicker', { value: picker, configurable: true });
    return { written, calls: () => calls };
  }

  afterEach(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  async function savingRefused() {
    const picker = installRefusingPicker();
    const { controller } = makeController({}, webFiles);
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    let saved: Promise<boolean> | null = null;
    act(() => void (saved = controller.save()));
    const dialog = await screen.findByRole('alertdialog', { name: 'Untitled.checked.txt is ready to save' });
    return { picker, controller, dialog, saved: saved! };
  }

  it('asks "Untitled.checked.txt is ready to save" with focus on Save; Save opens the picker and writes the built file', async () => {
    const { picker, controller, dialog, saved } = await savingRefused();
    const save = within(dialog).getByRole('button', { name: 'Save' });
    // Dialog moves focus in a passive effect: under load it can run after findByRole resolves (#32).
    await waitFor(() => expect(document.activeElement).toBe(save));
    await act(async () => fireEvent.click(save));
    expect(await saved).toBe(true);
    expect(picker.calls()).toBe(2);
    expect(picker.written.map((w) => w.name)).toEqual(['Untitled.checked.txt']);
    expect(new TextDecoder().decode(picker.written[0].bytes)).toBe('The cat sat on the mat.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(controller.getState().notice).toEqual(msg('notice.saved', { path: 'Untitled.checked.txt' }));
  });

  it('Escape cancels: nothing written, no error, the work still unsaved', async () => {
    const { picker, controller, dialog, saved } = await savingRefused();
    await act(async () => fireEvent.keyDown(dialog, { key: 'Escape' }));
    expect(await saved).toBe(false);
    expect(picker.written).toEqual([]);
    expect(picker.calls()).toBe(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(controller.getState().error).toBeNull();
  });
});

describe('read aloud on the web (Web Task 4: on-device voices only)', () => {
  /** Chrome's Google voices are network voices: they would send the text to Google. */
  const GOOGLE_HINDI = { voiceURI: 'Google हिन्दी', name: 'Google हिन्दी', lang: 'hi-IN', localService: false, default: true };
  const NO_OFFLINE_VOICE = 'No offline voice is installed';

  it('with only network voices, the read-aloud bar’s place says no offline voice is installed', async () => {
    const speech = installSpeech([GOOGLE_HINDI, { ...GOOGLE_HINDI, voiceURI: 'Google US English', name: 'Google US English', lang: 'en-US' }]);
    try {
      const { controller } = makeController();
      renderShell(controller);
      await openAndWait(controller, () => controller.openSample());
      await waitFor(() => expect(reviewPanel().textContent).toContain(NO_OFFLINE_VOICE), { timeout: 5000 });
      expect(within(reviewPanel()).queryByRole('button', { name: /Sentence/ })).toBeNull();
    } finally {
      speech.remove();
    }
  });

  it('with an on-device voice, the bar reads and there is no note', async () => {
    const speech = installSpeech([GOOGLE_HINDI, LOCAL_VOICE]);
    try {
      const { controller } = makeController();
      renderShell(controller);
      await openAndWait(controller, () => controller.openSample());
      await within(reviewPanel()).findByRole('group', { name: 'Read aloud' });
      expect(reviewPanel().textContent).not.toContain(NO_OFFLINE_VOICE);
    } finally {
      speech.remove();
    }
  });
});

describe('leaving the page', () => {
  function leavePage(): Event {
    const event = new Event('beforeunload', { cancelable: true });
    act(() => void window.dispatchEvent(event));
    return event;
  }

  it('with unsaved work: the browser asks, and Kashiro’s own dialog doesn’t follow', async () => {
    await withUnsavedWork();
    expect(leavePage().defaultPrevented).toBe(true);
    await act(async () => {});
    expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' })).toBeNull();
  });

  it('without unsaved work: nothing asks', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    expect(controller.hasUnsavedWork()).toBe(false);
    expect(leavePage().defaultPrevented).toBe(false);
  });
});
