import { describe, it, expect, beforeAll, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { makeController, noFiles, warmLinter } from './harness';
import { installSpeech, LOCAL_VOICE, ONLINE_VOICE, openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const statusTexts = () => screen.getAllByRole('status').map((s) => s.textContent ?? '');

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

  it('module switches are switches', () => {
    const { controller } = makeController();
    renderShell(controller);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('switch', { name: /Names card/ })).toBeTruthy();
  });
});

describe('screen reader: announcements', () => {
  it('a decision is announced politely with what is left', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    expect(statusTexts().join('')).toBe('');
    // The first card may be a batch: Enter opens its preview, a second Enter applies it.
    for (let i = 0; i < 2 && !controller.getState().announcement; i++) fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    const said = controller.getState().announcement!.text;
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
    expect(screen.getByRole('group', { name: /^Card 1 of \d+\. (Correctness|Clarity|Style|Terms|Names and places)/ })).toBeTruthy();
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
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect(screen.getByText(/No voice that works offline is installed/)).toBeTruthy();
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
