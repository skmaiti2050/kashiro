// axe-core on the rendered app (Task A1): every main screen, failing on serious or critical violations.
// AXE_REPORT=1 prints every violation (any impact) per screen, for the task report.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import axe from 'axe-core';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import type { Dictionary } from '@/engine/dictionary/lookup';
import { buildDocx } from '../fixtures/make_docx';
import { deferred, fakeDictionary } from './fakeDictionary';
import { DEFAULT_READING } from '@/ui/state/readingSettings';
import { memorySessionFiles } from '../fixtures/memorySessionFiles';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, installSpeech, LOCAL_VOICE, openAndWait, renderShell, reviewPanel, settingsTab } from './shell';

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
    // One audit per kind of card: cards of a kind share their markup, and an audit per card took 20 s under load.
    for (let i = 0; i < total; i++) {
      const card = reviewPanel().querySelector<HTMLElement>('.card')!;
      if (!kinds.has(card.className)) await audit(`card ${card.className} (${i + 1})`);
      kinds.add(card.className);
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
    // Every batch card but the simple-fixes card starts with nothing ticked (Task F10).
    fireEvent.click(buttonNamed(batch, /^Choose /)!);
    expect(screen.getByText('Nothing starts ticked. Tick each place you want to fix.')).toBeTruthy();
    await audit('batch preview');
  }, 60_000);

  it('the "Repeated words" preview with nothing ticked and Apply disabled (F8 re-review 7, M-4)', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('He had had enough of it. The film was very very good.'));
    const card = showCard('.card', (c) => buttonNamed(c, /^Choose which to fix/) !== undefined)!;
    expect(card).not.toBeNull();
    fireEvent.click(buttonNamed(card, /^Choose which to fix/)!);
    expect(screen.getByText('Nothing starts ticked. Tick each place you want to fix.')).toBeTruthy();
    await audit('repeated-words preview, nothing ticked');
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
    expect(screen.getByText('All clear: nothing to fix, nothing left to decide.')).toBeTruthy();
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

      chooseFromMore('Settings');
      for (const tab of ['Reading', 'Checking', 'Saving', 'Modules', 'Language']) {
        settingsTab(tab);
        await audit(`settings dialog › ${tab} (read aloud available)`);
      }
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      chooseFromMore('Google Docs');
      await audit('Google Docs help dialog');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      chooseFromMore('Keyboard shortcuts');
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

  it('saved reviews: the Recent reviews list and the resume prompt', async () => {
    const disk = memorySessionFiles();
    const file = { name: 'note.txt', path: '/docs/note.txt', bytes: new TextEncoder().encode('She recieved the letter.\n\nWe was late.') };
    const first = makeController({}, undefined, disk.files).controller;
    await first.openFile(file);
    first.reject(first.getState().session!.decisions().top[0].id);
    await first.reviews.flush();

    const { controller } = makeController({}, undefined, disk.files);
    renderShell(controller);
    await act(() => controller.reviews.startUp());
    expect(screen.getByRole('region', { name: 'Recent reviews' })).toBeTruthy();
    await audit('start screen with recent reviews');
    await openAndWait(controller, () => controller.openFile(file));
    await screen.findByRole('alertdialog', { name: 'Resume your review?' });
    await audit('resume prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    chooseFromMore('Settings');
    settingsTab('Saving');
    fireEvent.click(screen.getByRole('button', { name: 'Delete all saved reviews' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete all saved reviews?' })).toBeTruthy();
    await audit('delete all saved reviews: confirmation');
  });

  it('the Dictionary panel: words, a search with no match, and after Merge duplicates', async () => {
    renderShell(makeController({ dictionary: ['Vantix', 'vantix', 'Nashik'] }).controller);
    chooseFromMore('Dictionary…');
    await audit('dictionary panel');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the dictionary' }), { target: { value: 'zzz' } });
    await audit('dictionary panel: no match');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Merge duplicates' })));
    await audit('dictionary panel: merged');
  });

  it('Report a bug', async () => {
    renderShell(makeController().controller);
    chooseFromMore('Report a bug…');
    await screen.findByDisplayValue(/Kashiro bug report/);
    await audit('report a bug');
  });

  it('Settings without a local voice', async () => {
    renderShell(makeController().controller);
    chooseFromMore('Settings');
    await audit('settings dialog (no local voice)');
  });

  it('word lookup: loading, a result side by side, no definition, and the text menu', async () => {
    const loading = deferred<Dictionary>();
    const { controller } = makeController({}, undefined, undefined, () => loading.promise);
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const card = showCard('.card', (c) => c.querySelector('.card-title')?.textContent?.includes('recieve') ?? false)!;
    fireEvent.click(within(card).getByRole('button', { name: 'Look up' }));
    await audit('lookup: loading');
    await act(async () => loading.resolve(fakeDictionary));
    expect(screen.getByText('Definitions in English.')).toBeTruthy();
    await audit('lookup: original and suggestion');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('lakh') + 1 } });
    });
    fireEvent.keyDown(view.contentDOM, { key: 'd', ctrlKey: true });
    expect(await within(screen.getByRole('dialog', { name: 'Look up “lakh”' })).findByText('No definition found')).toBeTruthy();
    await audit('lookup: no definition');
  });

  it('word lookup: the failed-load message, and the text menu in a read-only .docx', async () => {
    const { controller } = makeController({}, undefined, undefined, () => Promise.reject(new Error('resource not found')));
    renderShell(controller);
    const bytes = await buildDocx('<w:p><w:r><w:t>The cat sat on the mat.</w:t></w:r></w:p>');
    await openAndWait(controller, () => controller.openFile({ name: 'essay.docx', path: '/docs/essay.docx', bytes }));
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    const node = view.contentDOM.querySelector('.cm-line')!.firstChild!;
    act(() => {
      window.getSelection()!.collapse(node, node.textContent!.indexOf('cat') + 1);
    });
    fireEvent.contextMenu(view.contentDOM);
    expect(screen.getByRole('menu', { name: 'Text actions' })).toBeTruthy();
    await audit('text menu');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Look up “cat”' }));
    expect(await screen.findByText(/The dictionary could not be loaded/)).toBeTruthy();
    await audit('lookup: failed load');
  });

  it('F23: a category filter pressed, the divider moved, and the panel folded to its strip', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by category' })).getAllByRole('button')[0]);
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize the review panel' }), { key: 'ArrowLeft' });
    await audit('category filter pressed, divider moved');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the review panel' }));
    await audit('review panel folded');
  });

  it('F23: the quick-fix popover on an underline', async () => {
    const { controller } = makeController({ preset: 'blog' });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('Each farmer should recieve water.'));
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('recieve') + 1 } });
    });
    fireEvent.keyDown(view.contentDOM, { key: 'Enter', altKey: true });
    expect(screen.getByRole('dialog', { name: /^Quick fix/ })).toBeTruthy();
    await audit('quick-fix popover');
  });

  it('About: the list of notices, then each notice shown alone', async () => {
    renderShell(makeController().controller);
    chooseFromMore('About');
    const dialog = await screen.findByRole('dialog', { name: 'About Kashiro' });
    await audit('About');
    const names = within(dialog.querySelector('.notices') as HTMLElement)
      .getAllByRole('button')
      .map((b) => b.textContent!);
    for (const name of names) {
      fireEvent.click(within(dialog).getByRole('button', { name }));
      await audit(`About › ${name}`);
      // Readable text, not Markdown source (Task U3 item 8); the licence texts stay verbatim in <pre>.
      const shown = [...dialog.querySelectorAll('.notice-markdown > :not(pre)')].map((el) => el.textContent ?? '');
      expect(shown.filter((text) => /^#|```|\*\*|\]\(/.test(text))).toEqual([]);
      if (name.startsWith('Fonts')) {
        expect(within(dialog).getByRole('heading', { name: 'Fonts attribution' })).toBeTruthy();
        expect([...dialog.querySelectorAll('pre')].some((pre) => pre.textContent!.includes('SIL OPEN FONT LICENSE Version 1.1'))).toBe(true);
      }
      fireEvent.click(within(dialog).getByRole('button', { name: 'Back to the list' }));
    }
  });
});
