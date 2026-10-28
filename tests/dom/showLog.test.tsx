/**
 * Task F20 item 8 (owner found it): "See the change log" on the All-clear card only opened the log, so with the log
 * already open nothing visible happened. It now always takes the user there: opens it, moves focus to its toggle,
 * scrolls it into view and highlights it briefly (without motion when the user asks for less).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const logToggle = () => screen.getByRole('button', { name: /Change log/ });
const log = () => document.querySelector<HTMLElement>('.changelog')!;

async function allClear() {
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled;
  const { controller } = makeController();
  renderShell(controller);
  await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
  return { seeLog: within(reviewPanel()).getByRole('button', { name: 'See the change log' }), scrolled };
}

describe('"See the change log" always takes the user to the log (Task F20 item 8)', () => {
  it('with the log closed: opens it and moves focus to it', async () => {
    const { seeLog, scrolled } = await allClear();
    expect(logToggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(seeLog);
    expect(logToggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(logToggle());
    expect(scrolled).toHaveBeenCalled();
  });

  it('with the log already open: moves focus into it, scrolls it into view and highlights it', async () => {
    const { seeLog, scrolled } = await allClear();
    fireEvent.click(logToggle());
    expect(logToggle().getAttribute('aria-expanded')).toBe('true');
    seeLog.focus();
    fireEvent.click(seeLog);
    expect(logToggle().getAttribute('aria-expanded')).toBe('true');
    expect(log().contains(document.activeElement)).toBe(true);
    expect(scrolled).toHaveBeenCalled();
    expect(log().classList.contains('reveal')).toBe(true);
  });

  it('the highlight is an outline that shows without motion; only its fade is animated, and not when the user asks for less', () => {
    const css = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
    expect(css).toMatch(/\.changelog\.reveal\s*\{[^}]*outline:[^}]*animation:/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\*,[^{]*\{[^}]*animation: none !important/);
  });
});
