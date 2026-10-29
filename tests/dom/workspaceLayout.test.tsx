/**
 * Task F27 item 2 (controller's browser pass): at the 760×480 minimum window with 200% app text the toolbar took
 * three rows, the workspace row shrank to 30 px, and the review panel (its padding alone is 48 px at 200%) drew its
 * buttons over "Offline · 89 words" in the status bar. Measured in Chrome, before: rows 262 / 0 / 30 / 106 / 82 px,
 * the panel 48 px tall in a 30 px row, and every point of the status bar's top edge hit the panel. After: the
 * workspace is clipped to its row, so the status bar is hit even with a 0 px row; Goal, the variant pill and Improve
 * share a strip that scrolls sideways in a short window, so the toolbar keeps one row; the status bar's wrapped line
 * sits 4 px below the first; the document's margin is 8 px. The document shows 6.7 lines there (it showed 2.6).
 * jsdom has no layout, so these check the grid and the rules that keep each row in its own track.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { makeController } from './harness';
import { openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const APP_CSS = readFileSync('src/ui/app.css', 'utf8');
const CSS = APP_CSS + readFileSync('src/ui/a11y.css', 'utf8');
const style = document.createElement('style');
beforeAll(() => {
  style.textContent = CSS;
  document.head.append(style);
});
afterAll(() => style.remove());

/**
 * The declarations of every rule whose whole selector is `selector` (at the start of a line, not after a ","), each
 * closed by "}" so a pattern can't run from one rule into the next.
 */
function rule(selector: string, css = CSS): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n)\\s*(?<!,\\n)${escaped} \\{([^}]*)\\}`, 'g'))].map((m) => `${m[1]}}`).join('\n');
}

/** The body of every `@media (max-height: 600px)` block in app.css, joined. */
function shortWindowRules(): string {
  return [...APP_CSS.matchAll(/@media \(max-height: 600px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
}

describe('nothing draws over the status bar or the change log (F27 item 2)', () => {
  it('the workspace row is minmax(0, 1fr): it gives up its height before the rows around it', () => {
    expect(rule('.app')).toMatch(/display: grid;[^}]*grid-template-rows: auto auto minmax\(0, 1fr\) auto auto;/);
  });

  it('the header, workspace, status bar and change log each have a track of their own', () => {
    expect(rule('.app-header')).toMatch(/grid-row: 1;/);
    expect(rule('.workspace')).toMatch(/grid-row: 3;/);
    expect(rule('.statusbar')).toMatch(/grid-row: 4;/);
    expect(rule('.changelog')).toMatch(/grid-row: 5;/);
  });

  it('the workspace clips what it holds, so a pane taller than its row is cut at the row’s edge', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('Each farmer should get water.'));
    const workspace = document.querySelector('.workspace')!;
    expect(rule('.workspace')).toMatch(/min-height: 0;[^}]*overflow: clip;/);
    expect(getComputedStyle(workspace).overflow).toBe('clip');
    // The review panel and the status bar are siblings in different tracks: the panel sits inside the workspace.
    expect(workspace.querySelector('.review')).not.toBeNull();
    expect(workspace.contains(document.querySelector('.statusbar'))).toBe(false);
    expect(workspace.contains(document.querySelector('.changelog'))).toBe(false);
  });

  it('the divider’s focus ring is drawn inside it, where the workspace’s clip leaves it whole', () => {
    expect(rule('.panel-divider:focus-visible')).toMatch(/outline-offset: -2px;/);
  });
});

describe('a short window keeps the document readable (F27 item 2)', () => {
  it('Goal and the variant pill are in one strip, a plain part of the toolbar in a tall window', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('Each farmer should get water.'));
    const strip = document.querySelector('.toolbar > .toolbar-secondary')!;
    expect(strip).not.toBeNull();
    expect(strip.contains(screen.getByRole('combobox', { name: 'Goal' }))).toBe(true);
    expect(strip.querySelector('.chip select')).not.toBeNull();
    expect(rule('.toolbar-secondary')).toMatch(/display: contents;/);
  });

  it('in a window under 600 px tall the strip takes the free space and scrolls sideways; each item keeps its size', () => {
    const short = shortWindowRules();
    const strip = rule('.toolbar-secondary', short);
    expect(strip).toMatch(/display: flex;[^}]*flex: 1 1 0;[^}]*min-width: 4em;/);
    expect(strip).toMatch(/overflow-x: auto;/);
    // Without it the strip's content widened the toolbar to 937 px in a 760 px window.
    expect(strip).toMatch(/contain: inline-size;/);
    // The focus ring (2 px, 2 px outside) fits in the padding instead of being cut by the scrolling box.
    expect(strip).toMatch(/padding: 4px;/);
    expect(rule('.toolbar-secondary > *', short)).toMatch(/flex-shrink: 0;/);
    expect(rule('.toolbar .spacer', short)).toMatch(/flex: 0;/);
    expect(rule('.editor .cm-scroller', short)).toMatch(/padding-block: 8px;/);
  });

  it('the toolbar still wraps (Task L1), and the status bar’s wrapped line sits close', () => {
    expect(rule('.toolbar')).toMatch(/flex-wrap: wrap;/);
    // The status bar's own rule (the narrow layout already had this gap).
    expect(rule('.statusbar')).toMatch(/flex-wrap: wrap;[^}]*gap: 4px 16px;[^}]*min-height: 24px;/);
  });

  it('the narrow (≤720 px) layout is as before: the app grows, the panel under the document', () => {
    const narrow = /@media \(max-width: 720px\) \{([\s\S]*?)\n\}/.exec(CSS)![1];
    expect(rule('.app', narrow)).toMatch(/height: auto;[^}]*min-height: 100vh;/);
    expect(rule('.workspace', narrow)).toMatch(/grid-template-columns: minmax\(0, 1fr\);[^}]*grid-template-rows: minmax\(50vh, auto\) auto;/);
  });
});
