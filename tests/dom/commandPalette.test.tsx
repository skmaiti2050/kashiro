// F23 item 6 (list item 18): Ctrl+K opens a command palette, a dialog with a combobox and a listbox (the WAI-ARIA
// combobox pattern). Typing filters, Enter runs, Escape closes and focus returns. Each entry calls the same function
// as its button; an action that can't run now is shown disabled.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const palette = () => screen.queryByRole('dialog', { name: 'Command palette' });
const box = () => screen.getByRole('combobox', { name: 'Type a command' }) as HTMLInputElement;
const options = () => within(screen.getByRole('listbox')).queryAllByRole('option');
/** Each entry's label, without its key hint. */
const label = (option: HTMLElement) => option.querySelector('.palette-label')!.textContent;
const optionNames = () => options().map(label);
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const press = (key: string) => fireEvent.keyDown(box(), { key });
const openPalette = (from: Element = document.body) => fireEvent.keyDown(from, { key: 'k', ctrlKey: true });
const slotTitle = () => reviewPanel().querySelector('.card-title')!.textContent;

describe('the command palette (F23 item 6)', () => {
  it('Ctrl+K opens it as a combobox over a listbox, focused, with the first enabled entry active', () => {
    renderShell(makeController().controller);
    openPalette();
    expect(palette()).not.toBeNull();
    expect(document.activeElement).toBe(box());
    expect(box().getAttribute('aria-expanded')).toBe('true');
    const listbox = screen.getByRole('listbox');
    expect(box().getAttribute('aria-controls')).toBe(listbox.id);
    const active = document.getElementById(box().getAttribute('aria-activedescendant')!)!;
    expect(active.getAttribute('role')).toBe('option');
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.getAttribute('aria-disabled')).not.toBe('true');
    expect(optionNames()).toEqual(expect.arrayContaining(['Open', 'Paste', 'Settings', 'Dictionary…', 'Check for updates…', 'Next card']));
  });

  it('typing filters the list; no match says so', () => {
    renderShell(makeController().controller);
    openPalette();
    type('dict');
    expect(optionNames()).toEqual(['Dictionary…']);
    type('zzzz');
    expect(options()).toHaveLength(0);
    expect(palette()!.textContent).toContain('No command matches.');
  });

  it('Enter runs the active entry: the Dictionary panel opens as from the ⋯ menu', () => {
    renderShell(makeController().controller);
    openPalette();
    type('dictionary');
    press('Enter');
    expect(palette()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Dictionary' })).toBeTruthy();
  });

  it('Escape closes it and focus returns where it was', () => {
    renderShell(makeController().controller);
    const open = screen.getByRole('button', { name: 'Open' });
    open.focus();
    openPalette(open);
    press('Escape');
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('an action that can’t run now is disabled, and Enter on it does nothing', () => {
    renderShell(makeController().controller);
    openPalette();
    type('save');
    const save = options().find((o) => label(o) === 'Save')!;
    expect(save.getAttribute('aria-disabled')).toBe('true');
    press('Enter');
    expect(palette()).not.toBeNull();
  });

  it('the arrow keys move the active entry; Next card does what J does', async () => {
    const { controller } = makeController({ preset: 'blog' });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('We could of finished it sooner. Each farmer should recieve water. He dont know.'));
    const first = slotTitle();
    fireEvent.keyDown(reviewPanel(), { key: 'j' });
    const second = slotTitle();
    fireEvent.keyDown(reviewPanel(), { key: 'k' });
    expect(slotTitle()).toBe(first);

    openPalette();
    type('card');
    const before = box().getAttribute('aria-activedescendant');
    press('ArrowDown');
    expect(box().getAttribute('aria-activedescendant')).not.toBe(before);
    press('ArrowUp');
    expect(box().getAttribute('aria-activedescendant')).toBe(before);
    type('next card');
    press('Enter');
    expect(slotTitle()).toBe(second);
  });

  it('a click on an entry runs it: Theme Dark sets the theme as Settings does', async () => {
    const { controller } = makeController();
    renderShell(controller);
    openPalette();
    type('dark');
    await act(async () => fireEvent.click(options()[0]));
    expect(controller.getState().settings.reading.theme).toBe('dark');
  });
});
