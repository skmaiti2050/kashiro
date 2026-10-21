// axe-core on the rendered app (Task A1): every main screen, failing on serious or critical violations.
// AXE_REPORT=1 prints every violation (any impact) per screen, for the task report.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import axe from 'axe-core';
import { act, fireEvent, screen } from '@testing-library/react';
import { buildDocx } from '../fixtures/make_docx';
import { DEFAULT_READING } from '@/ui/state/readingSettings';
import { makeController, warmLinter } from './harness';
import { installSpeech, LOCAL_VOICE, openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** Runs axe on the whole page; fails on serious or critical violations. */
async function audit(screenName: string): Promise<void> {
  // CodeMirror reports focus moving away (into a dialog) on a timer: let it land inside act().
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  const results = await axe.run(document.body, { resultTypes: ['violations'] });
  if (process.env.AXE_REPORT) {
    const found = results.violations.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}`);
    console.log(`axe ${screenName}: ${found.length ? found.join(', ') : 'no violations'}`);
  }
  const blocking = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${screenName}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(blocking).toEqual([]);
}

/** Presses J in the panel until the current card matches (null when the queue has none). */
function showCard(selector: string, matches: (card: HTMLElement) => boolean = () => true): HTMLElement | null {
  for (let i = 0; i < 25; i++) {
    const card = reviewPanel().querySelector<HTMLElement>(selector);
    if (card && matches(card)) return card;
    fireEvent.keyDown(reviewPanel(), { key: 'j' });
  }
  return null;
}

const buttonNamed = (card: HTMLElement, text: RegExp) => [...card.querySelectorAll('button')].find((b) => text.test(b.textContent ?? ''));

describe('axe-core: no serious or critical violations', () => {
  it('start screen (empty state)', async () => {
    renderShell(makeController().controller);
    await audit('empty state');
  });

  it('review panel: every card of the sample, the dismiss menu, the batch preview and "See each"', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const kinds = new Set<string>();
    const total = controller.getState().session!.decisionCount();
    for (let i = 0; i < total; i++) {
      const card = reviewPanel().querySelector<HTMLElement>('.card')!;
      kinds.add(card.className);
      await audit(`card ${card.className} (${i + 1})`);
      fireEvent.keyDown(reviewPanel(), { key: 'j' });
    }
    expect([...kinds].sort()).toEqual(['card', 'card names', 'card terms']);

    const dismiss = showCard('.card:has([aria-haspopup="menu"])');
    expect(dismiss).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss ▾' }));
    await audit('dismiss menu open');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    const batch = showCard('.card', (card) => buttonNamed(card, /^See each$/) !== undefined)!;
    expect(batch).not.toBeNull();
    fireEvent.click(buttonNamed(batch, /^See each$/)!);
    await audit('batch: see each');
    fireEvent.click(buttonNamed(batch, /^Apply /)!);
    expect(screen.getByText(/Untick any place/)).toBeTruthy();
    await audit('batch preview');
  });

  it('Indian-language words card', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('He said chalo, and we will jion the bhalo party.'));
    expect(showCard('.card.other-language')).not.toBeNull();
    await audit('other-language card');
  });

  it('a read-only .docx and the done state', async () => {
    const { controller } = makeController();
    renderShell(controller);
    const bytes = await buildDocx('<w:p><w:r><w:t>The cat sat on the mat.</w:t></w:r></w:p>');
    await openAndWait(controller, () => controller.openFile({ name: 'essay.docx', path: '/docs/essay.docx', bytes }));
    expect(screen.getByText(/Done: nothing to decide/)).toBeTruthy();
    await audit('read-only docx, done state');
  });

  it('change log with entries, and the save menu', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    fireEvent.click(screen.getByRole('button', { name: /Change log/ }));
    await audit('change log open');
    const menu = document.querySelector<HTMLDetailsElement>('.save-menu')!;
    act(() => {
      menu.open = true;
    });
    await audit('save menu open');
  });

  it('dialogs: Settings (with and without read aloud), Google Docs help, keyboard shortcuts, unsaved changes', async () => {
    const speech = installSpeech([LOCAL_VOICE]);
    try {
      const { controller } = makeController({ reading: { ...DEFAULT_READING, uiTextSize: 200 } });
      renderShell(controller);
      await openAndWait(controller, () => controller.openSample());
      await screen.findByRole('group', { name: 'Read aloud' });
      await audit('review panel with read aloud');

      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      await audit('settings dialog (read aloud available)');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      fireEvent.click(screen.getByRole('button', { name: 'Google Docs' }));
      await audit('Google Docs help dialog');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      fireEvent.click(screen.getByRole('button', { name: 'Shortcuts' }));
      await audit('keyboard shortcuts dialog');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      fireEvent.keyDown(reviewPanel(), { key: 'Backspace' });
      fireEvent.keyDown(document.body, { key: 'o', ctrlKey: true });
      expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeTruthy();
      await audit('unsaved changes dialog');
    } finally {
      speech.remove();
    }
  });

  it('Settings without a local voice', async () => {
    renderShell(makeController().controller);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await audit('settings dialog (no local voice)');
  });
});
