// F23 item 3 (list items 19 and 24): a divider between the document and the review panel that the mouse drags and
// the keyboard moves (a WAI-ARIA window splitter), and a button that folds the panel to a thin strip. Both remembered.
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { makeController, warmLinter } from './harness';
import { renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const divider = () => screen.getByRole('separator', { name: 'Resize the review panel' });
const width = () => divider().getAttribute('aria-valuenow');
const workspace = () => document.querySelector<HTMLElement>('.workspace')!;
const key = (k: string) => fireEvent.keyDown(divider(), { key: k });
/** The review panel (an aside; on the start screen it has no name yet). */
const panel = () => document.querySelector('aside.review');

describe('the resizable split (F23 item 3)', () => {
  it('is a focusable separator with its width, its bounds and its orientation', () => {
    renderShell(makeController().controller);
    expect(divider().tabIndex).toBe(0);
    expect(divider().getAttribute('aria-orientation')).toBe('vertical');
    expect(width()).toBe('380');
    expect(divider().getAttribute('aria-valuemin')).toBe('280');
    expect(divider().getAttribute('aria-valuemax')).toBe('800');
  });

  it('moves 16 px per arrow key towards the arrow, Home and End jump to the bounds, and it never passes them', () => {
    renderShell(makeController().controller);
    key('ArrowLeft');
    expect(width()).toBe('396');
    key('ArrowRight');
    key('ArrowRight');
    expect(width()).toBe('364');
    key('Home');
    expect(width()).toBe('280');
    key('ArrowRight');
    expect(width()).toBe('280');
    key('End');
    expect(width()).toBe('800');
    key('ArrowLeft');
    expect(width()).toBe('800');
    expect(workspace().style.getPropertyValue('--panel-width')).toContain('800px');
  });

  it('in a right-to-left layout the arrows are mirrored', () => {
    renderShell(makeController({ uiLanguage: 'en-XA' }).controller);
    document.querySelector('.app')!.setAttribute('dir', 'rtl');
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('396');
  });

  it('is remembered after a restart', () => {
    const first = renderShell(makeController().controller);
    key('ArrowLeft');
    key('ArrowLeft');
    first.unmount();
    renderShell(makeController().controller);
    expect(width()).toBe('412');
    expect(workspace().style.getPropertyValue('--panel-width')).toContain('412px');
  });
});

describe('folding the review panel (F23 item 3)', () => {
  it('folds to a strip with a button that brings it back; focus follows; remembered after a restart', () => {
    const first = renderShell(makeController().controller);
    fireEvent.click(screen.getByRole('button', { name: 'Hide the review panel' }));
    expect(panel()).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    const show = screen.getByRole('button', { name: 'Show the review panel' });
    expect(document.activeElement).toBe(show);
    expect(workspace().dataset.panel).toBe('collapsed');
    first.unmount();

    renderShell(makeController().controller);
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the review panel' }));
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide the review panel' }));
    expect(workspace().dataset.panel).toBe('open');
  });
});

describe('narrow windows keep the stacked layout (F23 item 3)', () => {
  it('at 720 px and below there is no divider and one column', () => {
    const css = readFileSync('src/ui/a11y.css', 'utf8');
    const narrow = css.slice(css.indexOf('@media (max-width: 720px)'));
    const block = narrow.slice(0, narrow.indexOf('\n}\n'));
    expect(block).toMatch(/\.panel-divider\s*\{\s*display:\s*none;/);
    expect(block).toMatch(/\.workspace\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  });
});
