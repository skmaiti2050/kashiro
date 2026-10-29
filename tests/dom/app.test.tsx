import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { english } from '../ui/english';
import { makeController, noFiles, warmLinter } from './harness';
import { chooseFromMore, installSpeech, LOCAL_VOICE, ONLINE_VOICE, openAndWait, renderShell, reviewPanel, settingsTab } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const statusTexts = () => screen.getAllByRole('status').map((s) => s.textContent ?? '');

describe('live regions behind a dialog', () => {
  it('an error raised while a dialog is open (a failed save from Unsaved changes) is announced: its alert is not inert', async () => {
    const failing = { ...noFiles, save: async () => Promise.reject(new Error('Access is denied.')) };
    const { controller } = makeController({}, failing);
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
    fireEvent.keyDown(document.body, { key: 'o', ctrlKey: true });
    const dialog = screen.getByRole('alertdialog', { name: 'Unsaved changes' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });

    const alert = await waitFor(() => {
      const found = screen.getAllByRole('alert').find((a) => a.textContent?.includes('Access is denied.'));
      expect(found).toBeTruthy();
      return found!;
    });
    expect(alert.closest('[inert]')).toBeNull();
    for (const status of document.querySelectorAll('[role="status"]')) expect(status.closest('[inert]')).toBeNull();
    // The dialog stays open after a failed save, and the rest of the page is still inert behind it.
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeTruthy();
    expect(document.querySelector('.toolbar')!.closest('[inert]')).not.toBeNull();
  });
});

describe('keyboard: shortcuts sheet and Settings', () => {
  it('F1 opens the keyboard shortcuts; Escape closes them and focus returns', () => {
    const { controller } = makeController();
    renderShell(controller);
    const open = screen.getByRole('button', { name: /Open a file/ });
    open.focus();
    fireEvent.keyDown(open, { key: 'F1' });
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(within(sheet).getByRole('table', { name: 'Anywhere' })).toBeTruthy();

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('? opens them from the review panel, but types a question mark in the text', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const text = document.querySelector<HTMLElement>('.cm-content')!;
    fireEvent.keyDown(text, { key: '?', shiftKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(reviewPanel(), { key: '?', shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('Ctrl+, opens Settings; the app text size applies at once', () => {
    const { controller, saved } = makeController();
    const { container } = renderShell(controller);
    fireEvent.keyDown(document.body, { key: ',', ctrlKey: true });
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    fireEvent.change(within(settings).getByRole('combobox', { name: 'App text size' }), { target: { value: '150' } });
    fireEvent.change(within(settings).getByRole('combobox', { name: 'Font' }), { target: { value: 'atkinson' } });

    const app = container.querySelector<HTMLElement>('.app')!;
    expect(app.style.getPropertyValue('--ui-zoom')).toBe('1.5');
    expect(app.dataset.font).toBe('atkinson');
    expect(saved.at(-1)!.reading).toMatchObject({ uiTextSize: 150, font: 'atkinson' });
  });

  it('Ctrl+/ opens the keyboard shortcuts, as F1 does (Task F21b item 10)', () => {
    const { controller } = makeController();
    renderShell(controller);
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('Settings › Show keyboard shortcuts on buttons: on at first; off hides the hints on buttons only (Task F21b item 10)', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
    document.head.append(style);
    try {
      const { controller, saved } = makeController();
      const { container } = renderShell(controller);
      const buttonHint = () => screen.getByRole('button', { name: /Open a file/ }).querySelector('.key-hint')!;
      expect(getComputedStyle(buttonHint()).display).not.toBe('none');

      fireEvent.keyDown(document.body, { key: ',', ctrlKey: true });
      const settings = screen.getByRole('dialog', { name: 'Settings' });
      const show = within(settings).getByRole('checkbox', { name: 'Show keyboard shortcuts on buttons' });
      expect((show as HTMLInputElement).checked).toBe(true);
      fireEvent.click(show);

      expect(container.querySelector<HTMLElement>('.app')!.dataset.keyHints).toBe('off');
      expect(saved.at(-1)!.reading.keyHints).toBe(false);
      expect(getComputedStyle(buttonHint()).display).toBe('none');
    } finally {
      style.remove();
    }
  });

  describe('Settings › Theme: System, Light or Dark (Task F21b item 4)', () => {
    /** Windows in dark mode or not, as matchMedia reports it; `flip` changes it and tells the listeners. */
    function systemTheme(dark: boolean) {
      const listeners = new Set<() => void>();
      const query = {
        get matches() {
          return dark;
        },
        addEventListener: (_: string, l: () => void) => listeners.add(l),
        removeEventListener: (_: string, l: () => void) => listeners.delete(l),
      };
      const original = window.matchMedia;
      window.matchMedia = ((q: string) => (q === '(prefers-color-scheme: dark)' ? query : original?.(q) ?? { matches: false })) as never;
      return {
        flip: () => {
          dark = !dark;
          listeners.forEach((l) => l());
        },
        restore: () => (window.matchMedia = original),
      };
    }
    const theme = () => document.documentElement.dataset.theme;

    it('System follows Windows, live; Light and Dark are applied at once, saved and remembered for the next start', () => {
      const windows = systemTheme(true);
      try {
        const { controller, saved } = makeController();
        renderShell(controller);
        expect(theme()).toBe('dark');
        act(() => windows.flip());
        expect(theme()).toBe('light');

        fireEvent.keyDown(document.body, { key: ',', ctrlKey: true });
        const select = within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('combobox', { name: 'Theme' });
        expect((select as HTMLSelectElement).value).toBe('system');
        fireEvent.change(select, { target: { value: 'dark' } });
        expect(theme()).toBe('dark');
        expect(saved.at(-1)!.reading.theme).toBe('dark');
        expect(localStorage.getItem('kashiro.theme')).toBe('dark');
        // A Windows switch no longer changes a chosen theme.
        act(() => windows.flip());
        expect(theme()).toBe('dark');
      } finally {
        windows.restore();
        localStorage.clear();
      }
    });
  });

  it('module switches are switches', () => {
    const { controller } = makeController();
    renderShell(controller);
    chooseFromMore('Settings');
    settingsTab('Modules');
    expect(screen.getByRole('switch', { name: /Names card/ })).toBeTruthy();
    expect(screen.getByRole('switch', { name: /your spelling of such words is never auto-changed/ })).toBeTruthy();
  });
});

describe('screen reader: announcements', () => {
  it('a decision is announced politely with what is left', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    // The check's result first (Task U3 item 2).
    expect(statusTexts().join('')).toMatch(/^Check finished: \d+ suggestions to decide\.$/);
    const afterCheck = controller.getState().announcement!.seq;
    // The first card may be a batch: Enter opens its preview, a second Enter applies it.
    for (let i = 0; i < 2 && controller.getState().announcement!.seq === afterCheck; i++) fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    const said = english(controller.getState().announcement!.message);
    expect(said).toMatch(/^(Accepted|Applied)\. \d+ of \d+ left\.$/);
    expect(statusTexts()).toContain(said);
  });

  it('a save is announced as "Saved as … "', async () => {
    const { controller } = makeController({}, noFiles);
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(statusTexts()).toContain('Saved as Sample.checked.txt'));
  });

  it('the current card is named with its position, category and change', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    expect(screen.getByRole('group', { name: /^Card 1 of \d+ left\. (Correctness|Clarity|Style|Terms|Names and places)/ })).toBeTruthy();
  });
});

describe('read aloud', () => {
  it('only a network voice: read aloud is hidden, and Settings says why', async () => {
    const speech = installSpeech([ONLINE_VOICE]);
    try {
      const { controller } = makeController();
      renderShell(controller);
      await openAndWait(controller, () => controller.openSample());
      expect(screen.queryByRole('group', { name: 'Read aloud' })).toBeNull();
      fireEvent.keyDown(reviewPanel(), { key: 's', altKey: true });
      expect(speech.spoken).toEqual([]);
      chooseFromMore('Settings');
      expect(screen.getByText(/No voice that works offline is installed/)).toBeTruthy();
    } finally {
      speech.remove();
    }
  });

  it('Escape in a dialog closes it and also stops the reading', async () => {
    const speech = installSpeech([LOCAL_VOICE]);
    try {
      renderShell(makeController().controller);
      fireEvent.keyDown(document.body, { key: ',', ctrlKey: true });
      const settings = screen.getByRole('dialog', { name: 'Settings' });
      await within(settings).findByRole('button', { name: 'Play a sample' });
      speech.synth.speaking = true;
      const stopsBefore = speech.synth.cancelled;
      fireEvent.keyDown(within(settings).getByRole('combobox', { name: 'Font' }), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(speech.synth.cancelled).toBeGreaterThan(stopsBefore);
    } finally {
      speech.remove();
    }
  });

  it('a local voice that arrives late (after a first, empty voiceschanged) still turns read aloud on', async () => {
    const speech = installSpeech([]);
    try {
      const { controller } = makeController();
      renderShell(controller);
      await openAndWait(controller, () => controller.openSample());
      act(() => speech.changeVoices([ONLINE_VOICE]));
      expect(screen.queryByRole('group', { name: 'Read aloud' })).toBeNull();
      act(() => speech.changeVoices([ONLINE_VOICE, LOCAL_VOICE]));
      expect(await screen.findByRole('group', { name: 'Read aloud' })).toBeTruthy();
    } finally {
      speech.remove();
    }
  });

  it('with a local voice: reads the card’s sentence and suggestion with that voice, never the online one', async () => {
    const speech = installSpeech([ONLINE_VOICE, LOCAL_VOICE]);
    try {
      const { controller } = makeController({ reading: { ...(await import('@/ui/state/readingSettings')).DEFAULT_READING, voice: 'Aria', rate: 1.5 } });
      renderShell(controller);
      await openAndWait(controller, () => controller.openSample());
      const bar = await screen.findByRole('group', { name: 'Read aloud' });

      fireEvent.click(within(bar).getByRole('button', { name: /Sentence/ }));
      fireEvent.keyDown(reviewPanel(), { key: 'r', altKey: true });
      expect(speech.spoken).toHaveLength(2);
      for (const s of speech.spoken) expect(s).toMatchObject({ voice: LOCAL_VOICE, rate: 1.5 });
      expect(speech.spoken[0].text).toMatch(/[.!?]$/);
      expect(speech.spoken[1].text).toMatch(/^(Correctness|Clarity|Style|Terms|Names and places)/);
    } finally {
      speech.remove();
    }
  });
});
