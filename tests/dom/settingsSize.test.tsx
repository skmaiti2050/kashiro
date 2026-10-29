// Task F26 item 3 (owner): the Settings dialog changed size from tab to tab. It has one fixed height now, at most
// 86% of the window: the tabs stay put and the panel scrolls inside. At the 760×480 minimum window with 200% text,
// where even the title and tabs take most of that height, the panel keeps a minimum and the dialog itself scrolls.
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { makeController } from './harness';
import { chooseFromMore, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const CSS = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
const style = document.createElement('style');
beforeAll(() => {
  style.textContent = CSS;
  document.head.append(style);
});
afterAll(() => style.remove());

/** The declarations of the first rule whose whole selector is `selector` (at the start of a line, not after a ","). */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)(?<!,\\n)${escaped} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
}

describe('the Settings dialog is the same size on every tab (F26 item 3)', () => {
  it('the dialog has a set height, the same on all five tabs; the panel is what scrolls', () => {
    renderShell(makeController().controller);
    chooseFromMore('Settings');
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const sizes = within(dialog)
      .getAllByRole('tab')
      .map((tab) => {
        fireEvent.click(tab);
        const box = getComputedStyle(dialog);
        const panel = getComputedStyle(within(dialog).getByRole('tabpanel'));
        return `${box.width} × ${box.height}; panel ${panel.overflowY}`;
      });
    expect(sizes[0]).toMatch(/× min\(\d+px, calc\(86vh \/ var\(--ui-zoom, 1\)\)\); panel auto$/);
    expect(new Set(sizes).size).toBe(1);
  });

  it('a column: title and tabs at their size, the panel takes the rest and keeps a minimum', () => {
    expect(rule('.dialog.settings')).toMatch(/display: flex;[^}]*flex-direction: column;/);
    expect(rule('.dialog.settings .tabpanel')).toMatch(/flex: 1 1 0;[^}]*min-height: 8em;[^}]*overflow-y: auto;/);
  });

  it('at the minimum window with 200% text the dialog still fits (86vh) and scrolls as a whole when it must', () => {
    const settings = rule('.dialog.settings');
    // vh is not scaled by the dialog's zoom (the text size), so it is divided by it, as .dialog's own limits are.
    expect(settings).toMatch(/height: min\(\d+px, calc\(86vh \/ var\(--ui-zoom, 1\)\)\);/);
    expect(settings).not.toMatch(/overflow(?:-y)?: (?:hidden|clip)/);
    // .dialog itself scrolls (overflow-y: auto) and is never taller than 86vh.
    expect(rule('.dialog')).toMatch(/max-height: 86vh;[^}]*overflow-y: auto;/);
  });

  // F27 item 3: a box's own scrollbar isn't cut by its border-radius or its overflow, so at 200% text the dialog's
  // scrollbar ran square past its rounded corners. Measured in Chrome at 760×480: the top-right and bottom-right
  // corner pixels hit the dialog (its scrollbar) before, and the backdrop after.
  it('the dialog is clipped to its rounded corners, its scrollbar with it', () => {
    renderShell(makeController().controller);
    chooseFromMore('Settings');
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const radius = /border-radius: (\d+px);/.exec(rule('.dialog'))![1];
    expect(rule('.dialog')).toMatch(new RegExp(`clip-path: inset\\(0 round ${radius}\\);`));
    expect(getComputedStyle(dialog).clipPath).toBe(`inset(0 round ${radius})`);
    expect(getComputedStyle(dialog).overflowY).toBe('auto');
  });
});
