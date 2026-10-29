// F23b item 1: Find in the document (Ctrl+F) with CodeMirror's search panel. Ctrl+F never reaches the browser's own
// find; Escape closes the panel and focus goes back. A read-only document gets Find only; in an editable one,
// Replace goes through the same path as typing. The labels are the app's, in its language.
// F23b item 2: About's privacy line names the two GitHub buttons.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { AboutDialog } from '@/ui/AboutDialog';
import type { SessionController } from '@/ui/state/sessionController';
import { buildDocx } from '../fixtures/make_docx';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const TEXT = 'Each farmer should get water. The water is cold.';

const editor = () => EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
const findPanel = () => document.querySelector<HTMLElement>('.cm-search');
const findField = () => screen.getByRole('textbox', { name: 'Find' }) as HTMLInputElement;
/** Ctrl+F on `target`; true when the key's default (the browser's own find) was left to run. */
const ctrlF = (target: Element) => fireEvent.keyDown(target, { key: 'f', ctrlKey: true });

async function openText(): Promise<SessionController> {
  return (await openTextApp()).controller;
}

async function openTextApp() {
  const { controller } = makeController({ preset: 'blog' });
  const { unmount } = renderShell(controller);
  await openAndWait(controller, () => controller.openText(TEXT));
  return { controller, unmount };
}

async function openDocx(): Promise<SessionController> {
  const { controller } = makeController();
  renderShell(controller);
  const bytes = await buildDocx('<w:p><w:r><w:t>The cat sat on the mat. The cat slept.</w:t></w:r></w:p>');
  await openAndWait(controller, () => controller.openFile({ name: 'essay.docx', path: '/docs/essay.docx', bytes }));
  return controller;
}

/** What a save would write, and the change log's entries (without their time stamps). */
function result(controller: SessionController) {
  const session = controller.getState().session!;
  const withoutTimes = (key: string, value: unknown) => (key === 'at' ? undefined : value);
  return {
    text: session.paragraphs().map((p) => session.outputText(p.id)),
    log: JSON.stringify(session.log(), withoutTimes),
  };
}

describe('Find in the document (F23b item 1)', () => {
  it('Ctrl+F in the text opens the panel on the Find field; Escape closes it and focus returns to the text', async () => {
    await openText();
    const view = editor();
    act(() => view.focus());
    expect(ctrlF(view.contentDOM)).toBe(false);
    expect(findPanel()).not.toBeNull();
    expect(document.activeElement).toBe(findField());

    fireEvent.keyDown(findField(), { key: 'Escape' });
    expect(findPanel()).toBeNull();
    expect(view.contentDOM.contains(document.activeElement)).toBe(true);
  });

  it('Ctrl+F outside the text opens it too, and never reaches the browser’s own find (also with no document)', async () => {
    const { controller } = makeController({ preset: 'blog' });
    renderShell(controller);
    expect(ctrlF(document.body)).toBe(false);
    await openAndWait(controller, () => controller.openText(TEXT));
    const open = screen.getByRole('button', { name: 'Open' });
    open.focus();
    expect(ctrlF(open)).toBe(false);
    expect(document.activeElement).toBe(findField());
    // Ctrl+F again in the field keeps it open and focused.
    expect(ctrlF(findField())).toBe(false);
    expect(document.activeElement).toBe(findField());
  });

  it('Enter in the Find field selects the next match', async () => {
    await openText();
    act(() => editor().focus());
    ctrlF(editor().contentDOM);
    fireEvent.change(findField(), { target: { value: 'water' } });
    // CodeMirror's panel reads the key code.
    fireEvent.keyDown(findField(), { key: 'Enter', keyCode: 13 });
    const { from, to } = editor().state.selection.main;
    expect(editor().state.sliceDoc(from, to)).toBe('water');
  });

  it('a read-only document gets Find only: no Replace field or buttons; Escape gives focus back where it was', async () => {
    await openDocx();
    const open = screen.getByRole('button', { name: 'Open' });
    open.focus();
    ctrlF(open);
    const panel = findPanel()!;
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(findField());
    expect(within(panel).queryByRole('textbox', { name: 'Replace with' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^Replace/ })).toBeNull();
    expect(within(panel).getAllByRole('textbox')).toHaveLength(1);

    fireEvent.keyDown(findField(), { key: 'Escape' });
    expect(findPanel()).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('keys typed in the panel of a read-only document never decide or move cards', async () => {
    const controller = await openDocx();
    ctrlF(document.body);
    const before = JSON.stringify(controller.getState().session!.decisions());
    const matchCase = within(findPanel()!).getByRole('checkbox', { name: 'Match case' });
    for (const key of ['Backspace', 'Delete', 'j', 'k', 'Enter']) fireEvent.keyDown(matchCase, { key });
    expect(JSON.stringify(controller.getState().session!.decisions())).toBe(before);
  });

  it('in an editable document, Replace all goes through the typing path: the same text, re-check and log as typing it', async () => {
    const { controller: typed, unmount } = await openTextApp();
    const changesBefore = typed.getState().textChanges;
    act(() => {
      const view = editor();
      const doc = view.state.doc.toString();
      const changes = [...doc.matchAll(/water/g)].map((m) => ({ from: m.index, to: m.index + 'water'.length, insert: 'milk' }));
      view.dispatch({ changes, userEvent: 'input.type' });
    });
    expect(typed.getState().textChanges).toBe(changesBefore + 1);
    await waitFor(() => expect(typed.getState().checking).toBe(false), { timeout: 10000 });
    const expected = result(typed);
    unmount();

    const replaced = await openText();
    act(() => editor().focus());
    ctrlF(editor().contentDOM);
    const panel = findPanel()!;
    fireEvent.change(findField(), { target: { value: 'water' } });
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Replace with' }), { target: { value: 'milk' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Replace all' }));
    expect(replaced.getState().textChanges).toBe(changesBefore + 1);
    expect(replaced.getState().checking).toBe(true);
    await waitFor(() => expect(replaced.getState().checking).toBe(false), { timeout: 10000 });
    expect(result(replaced)).toEqual(expected);
    expect(result(replaced).text.join('\n')).toContain('get milk. The milk is cold.');
  });

  it('the panel’s labels are in the UI language (Hindi)', async () => {
    const { controller } = makeController({ uiLanguage: 'hi', preset: 'blog' });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(TEXT));
    ctrlF(document.body);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'खोजें' }));
    expect(within(findPanel()!).getByRole('button', { name: 'सब बदलें' })).toBeTruthy();
  });

  it('the command palette has "Find in document" (Ctrl+F), disabled with no document; it opens the panel', async () => {
    const { controller } = makeController({ preset: 'blog' });
    renderShell(controller);
    const findOption = () =>
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .find((o) => o.querySelector('.palette-label')!.textContent === 'Find in document')!;
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox', { name: 'Type a command' }), { target: { value: 'find' } });
    expect(findOption().getAttribute('aria-disabled')).toBe('true');
    expect(findOption().textContent).toContain('Ctrl+F');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Type a command' }), { key: 'Escape' });

    await openAndWait(controller, () => controller.openText(TEXT));
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox', { name: 'Type a command' }), { target: { value: 'find' } });
    expect(findOption().getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Type a command' }), { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    expect(findPanel()).not.toBeNull();
    expect(document.activeElement).toBe(findField());
  });

  it('the keyboard shortcuts sheet lists Ctrl+F', () => {
    renderShell(makeController().controller);
    chooseFromMore('Keyboard shortcuts');
    const row = screen.getByRole('rowheader', { name: 'Ctrl+F' }).closest('tr')!;
    expect(row.textContent).toContain('Find in the document');
  });
});

describe('About’s privacy line (F23b item 2)', () => {
  it('says the GitHub buttons open the browser only on a click', () => {
    render(<AboutDialog onCheckUpdates={() => {}} onClose={() => {}} />);
    const about = screen.getByRole('dialog', { name: 'About Kashiro' });
    expect(about.textContent).toContain(
      'Kashiro never connects to the internet. The GitHub buttons (Report a bug, Check for updates) open your browser only when you click them.',
    );
  });
});
