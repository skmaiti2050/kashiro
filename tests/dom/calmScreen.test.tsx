/**
 * A calmer screen (Task U3 group 5): the toolbar keeps Open, Paste, Goal, the English variant and Save; the rest
 * is in one keyboard-accessible ⋯ menu (with Look up word and Close document); the done state is one calm line.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { DEFAULT_MODULES } from '@/engine/modules';
import { fakeDictionary } from './fakeDictionary';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const toolbar = () => screen.getByRole('toolbar');

describe('toolbar', () => {
  it('shows Open, Paste, Goal, the English variant and Save; the rest is behind ⋯', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const buttons = within(toolbar()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent!.trim());
    expect(buttons).toEqual(['Open', 'Paste', 'More', 'Save']);
    expect(within(toolbar()).getByRole('combobox', { name: 'Goal' })).toBeTruthy();
    expect(within(toolbar()).getByRole('combobox', { name: /English/ })).toBeTruthy();
  });

  it('the ⋯ menu: arrows move, Escape closes it and focus returns to ⋯', async () => {
    const { controller } = makeController({ modules: { ...DEFAULT_MODULES, wordLookup: true } }, undefined, undefined, () => Promise.resolve(fakeDictionary));
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More' });
    const items = within(menu).getAllByRole('menuitem').map((i) => i.textContent!.replace(/Ctrl\+\S+|F1/, '').trim());
    expect(items).toEqual(['Look up word', 'Close document', 'Google Docs', 'Keyboard shortcuts', 'Settings', 'About']);
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement!.textContent).toMatch(/^About/);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('Settings, Keyboard shortcuts and About open from the menu', async () => {
    const { controller } = makeController();
    renderShell(controller);
    chooseFromMore('Settings');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    chooseFromMore('Keyboard shortcuts');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('Look up word acts on the word at the cursor', async () => {
    const { controller } = makeController({ modules: { ...DEFAULT_MODULES, wordLookup: true } }, undefined, undefined, () => Promise.resolve(fakeDictionary));
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('I will receive it.'));
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('receive') + 2 } }));
    chooseFromMore('Look up word');
    expect(await screen.findByRole('dialog', { name: 'Look up “receive”' })).toBeTruthy();
  });

  it('Close document returns to the start screen', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    chooseFromMore('Close document');
    await waitFor(() => expect(controller.getState().document).toBeNull());
  });

  it('with no document, the menu has no Look up word or Close document', () => {
    renderShell(makeController({ modules: { ...DEFAULT_MODULES, wordLookup: true } }).controller);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent);
    expect(items.some((text) => /Look up|Close document/.test(text!))).toBe(false);
  });
});

describe('start screen', () => {
  it('says how to look a word up when word lookup is on', () => {
    renderShell(makeController({ modules: { ...DEFAULT_MODULES, wordLookup: true } }).controller);
    expect(screen.getByText(/put the cursor on a word and press Ctrl\+D/)).toBeTruthy();
  });
});

describe('done state', () => {
  it('nothing left: one calm line with the fixes applied, and no review-depth controls', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('I think teh cat sat on the mat.'));
    expect(controller.getState().session!.rankedDecisionCount()).toBe(0);
    expect(within(reviewPanel()).getByText('All clear: 1 fix applied, nothing left to decide.')).toBeTruthy();
    expect(within(reviewPanel()).queryByRole('group', { name: /Review depth/ })).toBeNull();
    expect(within(reviewPanel()).queryByRole('radiogroup', { name: /Review depth/ })).toBeNull();
    expect(within(reviewPanel()).queryByRole('slider')).toBeNull();
  });
});

// Task U3 fix 1: "detected" only when the text chose the variant; the fallback is the default.
describe('the English variant in the status bar and the toolbar', () => {
  const statusBar = () => document.querySelector('.statusbar')!.textContent;
  /** The variant menu's first choice: the variant the check chose itself. */
  const automatic = () => [...toolbar().querySelectorAll('option')].find((o) => / \((default|detected)\)$/.test(o.textContent ?? ''))?.textContent;

  it('says "(default)" when nothing in the text chose it, and "(detected)" when the spelling did', async () => {
    const { controller } = makeController({ fallbackVariant: 'Indian' });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    expect(statusBar()).toContain('Indian English (default)');
    expect(automatic()).toBe('Indian (default)');
    await openAndWait(controller, () => controller.openText('The colour of the organised behaviour was odd.'));
    expect(statusBar()).toContain('English (detected)');
    expect(automatic()).toMatch(/ \(detected\)$/);
  });
});
