// Task 11b UI: word lookup from a review item, Ctrl+D and right-click in the text, the module switch, and About.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import type { Dictionary } from '@/engine/dictionary/lookup';
import { DEFAULT_MODULES } from '@/engine/modules';
import { buildDocx } from '../fixtures/make_docx';
import { deferred, fakeDictionary } from './fakeDictionary';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const loaded = () => Promise.resolve(fakeDictionary);
const editor = () => EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
/** What the app's status regions (in the header, outside any dialog) say. */
const announced = () => within(document.querySelector<HTMLElement>('.app-header')!).getAllByRole('status').map((region) => region.textContent);
const ctrlD = (target: Element = document.body) => fireEvent.keyDown(target, { key: 'd', ctrlKey: true });

/** Puts the editor's cursor inside `word` (or selects it, with `select`). */
function cursorOn(word: string, select = false): EditorView {
  const view = editor();
  const at = view.state.doc.toString().indexOf(word);
  act(() => {
    view.focus();
    view.dispatch({ selection: select ? { anchor: at, head: at + word.length } : { anchor: at + 1 } });
  });
  return view;
}

/** Presses J in the panel until the current card's title mentions `word`. */
function showCardFor(word: string): HTMLElement {
  for (let i = 0; i < 25; i++) {
    const card = reviewPanel().querySelector<HTMLElement>('.card')!;
    if (card.querySelector('.card-title')?.textContent?.includes(word)) return card;
    fireEvent.keyDown(reviewPanel(), { key: 'j' });
  }
  throw new Error(`no card for ${word}`);
}

/** Opens a read-only .docx ("The cat sat on the mat.") with the given dictionary loader. */
async function openDocxWith(loader: () => Promise<Dictionary>): Promise<EditorView> {
  const { controller } = makeController({}, undefined, undefined, loader);
  renderShell(controller);
  const bytes = await buildDocx('<w:p><w:r><w:t>The cat sat on the mat.</w:t></w:r></w:p>');
  await openAndWait(controller, () => controller.openFile({ name: 'essay.docx', path: '/docs/essay.docx', bytes }));
  return editor();
}

/** A click (`whole` false: caret inside) or a mouse selection of `text` in the read-only text: the page's selection. */
function selectInDocx(text: string, whole = true): void {
  const line = [...editor().contentDOM.querySelectorAll('.cm-line')].find((l) => l.textContent?.includes(text))!;
  const node = line.firstChild!;
  const at = node.textContent!.indexOf(text);
  act(() => {
    const selection = window.getSelection()!;
    if (whole) selection.setBaseAndExtent(node, at, node, at + text.length);
    else selection.collapse(node, at + 1);
  });
}

async function openSampleWith(loader?: () => Promise<Dictionary>, wordLookup = true) {
  const { controller } = makeController({ modules: { ...DEFAULT_MODULES, wordLookup } }, undefined, undefined, loader);
  renderShell(controller);
  await openAndWait(controller, () => controller.openSample());
  return controller;
}

describe('Look up on a review item', () => {
  it('shows the original and the suggestion side by side, up to 3 senses each, then announces it', async () => {
    const loading = deferred<Dictionary>();
    const controller = await openSampleWith(() => loading.promise);
    const textBefore = controller.getState().document!.text;
    const card = showCardFor('recieve');
    const button = within(card).getByRole('button', { name: 'Look up' });
    button.focus(); // a real click focuses the button; fireEvent does not
    fireEvent.click(button);

    const panel = screen.getByRole('dialog', { name: 'Look up “recieve” and “receive”' });
    expect(within(panel).getByText('Loading dictionary…')).toBeTruthy();
    await act(async () => loading.resolve(fakeDictionary));

    const original = within(panel).getByRole('region', { name: 'Your text: recieve' });
    const suggestion = within(panel).getByRole('region', { name: 'Suggestion: receive' });
    expect(within(original).getByText('No definition found')).toBeTruthy();
    expect(within(suggestion).getAllByRole('listitem')).toHaveLength(3);
    expect(within(suggestion).getByText('get something; come into possession of').getAttribute('lang')).toBe('en');
    expect(within(panel).getByText('Definitions in English.')).toBeTruthy();
    expect(announced()).toContain('Definition loaded');

    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    // The panel only reads: no decision made, the text unchanged.
    expect(controller.getState().decided).toBe(0);
    expect(controller.getState().document!.text).toBe(textBefore);
  });

  it('the review keys do nothing behind the panel', async () => {
    const controller = await openSampleWith(loaded);
    fireEvent.click(within(showCardFor('recieve')).getByRole('button', { name: 'Look up' }));
    const panel = await screen.findByRole('dialog');
    await within(panel).findByText('Definitions in English.');
    fireEvent.keyDown(within(panel).getByRole('button', { name: 'Close' }), { key: 'Backspace' });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(controller.getState().decided).toBe(0);
  });

  it('a failed load says so, in an alert', async () => {
    await openSampleWith(() => Promise.reject(new Error('resource not found')));
    fireEvent.click(within(showCardFor('recieve')).getByRole('button', { name: 'Look up' }));
    const message = await screen.findByText(/The dictionary could not be loaded/);
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toBe('The dictionary could not be loaded: resource not found. Try again; if it keeps failing, reinstall Kashiro.');
  });
});

describe('Look up in the document', () => {
  it('Ctrl+D looks up the word at the cursor, with its badge; Esc closes and the cursor stays in the text', async () => {
    await openSampleWith(loaded);
    const view = cursorOn('lakh');
    ctrlD(view.contentDOM);
    const panel = screen.getByRole('dialog', { name: 'Look up “lakh”' });
    await within(panel).findByText('No definition found');
    expect(within(panel).getByText('Indian English')).toBeTruthy();
    expect(announced()).toContain('No definition found');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(view.contentDOM);
  });

  it('Ctrl+D looks up the selection; a hyphenated word is one word', async () => {
    await openSampleWith(loaded);
    ctrlD(cursorOn('farmers', true).contentDOM);
    const panel = screen.getByRole('dialog', { name: 'Look up “farmers”' });
    await within(panel).findByText('a person who operates a farm');
    expect(within(panel).getByText('(form of “farmer”)')).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'Escape' });

    ctrlD(cursorOn('coded').contentDOM);
    await within(screen.getByRole('dialog', { name: 'Look up “colour-coded”' })).findByText('having a colour code');
  });

  it('read-only .docx: Ctrl+D looks up the word where the user clicked', async () => {
    const view = await openDocxWith(loaded);
    expect(view.state.readOnly).toBe(true);
    selectInDocx('cat', false);
    ctrlD();
    const panel = screen.getByRole('dialog', { name: 'Look up “cat”' });
    await within(panel).findByText('feline mammal usually having thick soft fur');
  });

  it('editable text: right-click keeps the system menu (Cut, Paste, Select all)', async () => {
    await openSampleWith(loaded);
    const view = cursorOn('farmers');
    expect(fireEvent.contextMenu(view.contentDOM)).toBe(true); // not prevented
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('read-only .docx: right-click → Look up opens the panel; Escape closes the menu instead', async () => {
    const view = await openDocxWith(loaded);
    selectInDocx('cat');
    expect(fireEvent.contextMenu(view.contentDOM)).toBe(false); // prevented: the app's menu replaces the system one
    let menu = screen.getByRole('menu', { name: 'Text actions' });
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Look up “cat”' }));
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(menu.contains(document.activeElement)).toBe(false);

    selectInDocx('cat'); // the second right-click is a new click on the word
    fireEvent.contextMenu(view.contentDOM);
    menu = screen.getByRole('menu', { name: 'Text actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Look up “cat”' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await within(screen.getByRole('dialog', { name: 'Look up “cat”' })).findByText('Definitions in English.');
  });

  it('read-only .docx: right-click on a selection offers Copy too', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const view = await openDocxWith(loaded);
      selectInDocx('cat sat');
      fireEvent.contextMenu(view.contentDOM);
      const menu = screen.getByRole('menu', { name: 'Text actions' });
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Look up “cat sat”', 'Copy']);
      await act(async () => fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy' })));
      expect(writeText).toHaveBeenCalledWith('cat sat');
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('the menu closes when the page scrolls or the window is resized', async () => {
    const view = await openDocxWith(loaded);
    selectInDocx('cat');
    fireEvent.contextMenu(view.contentDOM);
    fireEvent.scroll(view.scrollDOM);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(view.contentDOM);
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the word lookup switch', () => {
  it('off: no Look up button, Ctrl+D and right-click do nothing, nothing is loaded', async () => {
    const loader = vi.fn(loaded);
    await openSampleWith(loader, false);
    expect(within(showCardFor('recieve')).queryByRole('button', { name: 'Look up' })).toBeNull();
    const view = cursorOn('farmers');
    ctrlD(view.contentDOM);
    const menuEvent = fireEvent.contextMenu(view.contentDOM);
    expect(menuEvent).toBe(true); // not prevented: the system menu shows
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('the shortcuts sheet lists Ctrl+D only while word lookup is on', async () => {
    await openSampleWith(loaded);
    chooseFromMore('Keyboard shortcuts');
    expect(screen.getByRole('rowheader', { name: 'Ctrl+D' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  });

  it('off: the shortcuts sheet has no Ctrl+D', async () => {
    await openSampleWith(loaded, false);
    chooseFromMore('Keyboard shortcuts');
    expect(screen.queryByRole('rowheader', { name: 'Ctrl+D' })).toBeNull();
  });
});

describe('About', () => {
  it('shows the version, the privacy line and every third-party notice in English', async () => {
    const { controller } = makeController();
    renderShell(controller);
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    chooseFromMore('About');
    // About loads its notices (about 1 MB of text) on demand; under the full suite's load that takes over 1 s.
    const dialog = await screen.findByRole('dialog', { name: 'About Kashiro' }, { timeout: 10_000 });
    expect(within(dialog).getByText('Version 1.2.1')).toBeTruthy();
    expect(within(dialog).getByText(/Your writing stays on this PC\./)).toBeTruthy();
    const notices = dialog.querySelector('.notices')!;
    expect(notices.getAttribute('lang')).toBe('en');
    expect(within(notices as HTMLElement).getAllByRole('button')).toHaveLength(8);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open English WordNet (word lookup)' }));
    expect(dialog.querySelector('.notices')!.textContent).toContain('Creative Commons Attribution 4.0 International License');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to the list' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fonts (SIL Open Font License)' }));
    expect(dialog.querySelector('.notices')!.textContent).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(dialog.querySelector('.notices')!.getAttribute('lang')).toBe('en');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Focus returns to ⋯, where About was chosen.
    expect(document.activeElement).toBe(more);
  });
});
