// Task F26 item 2 (owner): with Find open, opening About, Settings or Dictionary left the Find bar over the dialog,
// clipping its heading. CodeMirror's panels sit at z-index 300 (its tooltips at 500); the dialog backdrop was at 20.
// A modal dialog is above everything now. Find stays open under the backdrop (inert there, like the rest of the
// page), so closing the dialog brings the user back to their search as they left it.
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, openAndWait, renderShell, settingsTab } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const style = document.createElement('style');
beforeAll(async () => {
  style.textContent = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
  document.head.append(style);
  await warmLinter();
});
afterAll(() => style.remove());

const zIndex = (el: Element) => Number(getComputedStyle(el).zIndex);

async function openWithFind() {
  const { controller } = makeController({ preset: 'blog' });
  renderShell(controller);
  await openAndWait(controller, () => controller.openText('Each farmer should get water. The water is cold.'));
  const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
  act(() => view.focus());
  fireEvent.keyDown(view.contentDOM, { key: 'f', ctrlKey: true });
  expect(document.querySelector('.cm-search')).not.toBeNull();
}

/** The dialog's backdrop is above CodeMirror's panels and tooltips, and Find is inert under it. */
function expectDialogOnTop() {
  const backdrop = document.querySelector('.dialog-backdrop')!;
  const panels = document.querySelector('.cm-panels')!;
  expect(zIndex(panels)).toBeGreaterThanOrEqual(300); // CodeMirror's own value is read, not assumed
  expect(zIndex(backdrop)).toBeGreaterThan(zIndex(panels));
  expect(zIndex(backdrop)).toBeGreaterThan(500); // CodeMirror's tooltips
  expect(document.querySelector('.cm-search')!.closest('[inert]')).not.toBeNull();
}

describe('a modal dialog is above the Find panel (F26 item 2)', () => {
  it.each(['About Kashiro', 'Settings'])('%s, opened with Find open', async (title) => {
    await openWithFind();
    chooseFromMore(title === 'Settings' ? 'Settings' : 'About');
    await screen.findByRole('dialog', { name: title });
    expectDialogOnTop();
  });

  it('Dictionary, opened from Settings with Find open', async () => {
    await openWithFind();
    chooseFromMore('Settings');
    settingsTab('Checking');
    fireEvent.click(screen.getByRole('button', { name: /^Open the dictionary/ }));
    await screen.findByRole('dialog', { name: 'Dictionary' });
    expectDialogOnTop();
  });

  it('the backdrop is above every other layer the app sets (menus, text menu, undo toast)', () => {
    const css = style.textContent!;
    const backdrop = Number(/\.dialog-backdrop \{[^}]*z-index: (\d+);/.exec(css)![1]);
    const others = [...css.matchAll(/z-index: (\d+);/g)].map((m) => Number(m[1])).filter((z) => z !== backdrop);
    expect(Math.max(...others)).toBeLessThan(backdrop);
  });
});
