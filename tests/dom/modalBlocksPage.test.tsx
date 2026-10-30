// Task F28 item 1 (owner): in About, scrolling a long licence once scrolled the main screen behind the dialog: the
// wheel chained past the dialog's scroll box to the page. While a modal is open nothing behind it takes a click,
// focus, a key or a scroll: the rest of the app is inert, the page's own scroll is locked, and every scroll box in a
// dialog keeps its overscroll to itself.
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { makeController, warmLinter } from './harness';
import { chooseFromMore, openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

const CSS = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
const style = document.createElement('style');
beforeAll(async () => {
  style.textContent = CSS;
  document.head.append(style);
  await warmLinter();
});
afterAll(() => style.remove());

/** Top-level rules (not inside @media): each one's selector list and declarations. */
const RULES = [...CSS.matchAll(/(?:^|\n)((?:[.#a-z[][^{}\n]*,\n)*[.#a-z[][^{}\n]*) \{([^}]*)\}/gi)].map((m) => ({
  selectors: m[1].split(/,\n/).map((s) => s.trim()),
  body: m[2],
}));

/** The selectors of every rule that makes a box scroll. */
const SCROLLING = RULES.filter((r) => /overflow(?:-[xy])?: (?:auto|scroll);/.test(r.body)).flatMap((r) => r.selectors);

/** The selectors whose boxes keep their overscroll (no scroll chaining to the page). */
const CONTAINED = RULES.filter((r) => /overscroll-behavior: contain;/.test(r.body)).flatMap((r) => r.selectors);

/** Every box inside the open dialog's backdrop that can scroll: the dialog, the boxes CSS makes scroll, text areas. */
function scrollBoxesIn(backdrop: Element): Element[] {
  const boxes = new Set<Element>(backdrop.querySelectorAll('.dialog, textarea'));
  for (const selector of SCROLLING) backdrop.querySelectorAll(selector).forEach((el) => boxes.add(el));
  return [...boxes];
}

/** The scroll boxes of every open dialog that would still chain a wheel to the page. */
function uncontained(): string[] {
  return [...document.querySelectorAll('.dialog-backdrop')]
    .flatMap(scrollBoxesIn)
    .filter((el) => !CONTAINED.some((selector) => el.matches(selector)))
    .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
}

const root = () => document.documentElement;

/** About is loaded when first opened (its notices stay out of the main bundle): slow in a busy full run. */
const ABOUT_LOADS = { timeout: 10000 };

describe('a modal dialog blocks the page behind it (F28 item 1)', () => {
  it('everything outside the dialog is inert while it is open, and nothing after it closes', () => {
    renderShell(makeController().controller);
    chooseFromMore('Settings');
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog.closest('[inert]')).toBeNull();
    for (const part of ['.toolbar', '.workspace', '.statusbar', '.changelog']) {
      expect(document.querySelector(part)!.closest('[inert]'), part).not.toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('focus cannot leave it: every control outside is inert, and Tab from outside comes back in', () => {
    renderShell(makeController().controller);
    chooseFromMore('Settings');
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const outside = [...document.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')].filter(
      (el) => !dialog.contains(el) && el.closest('[data-live-regions]') === null,
    );
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.filter((el) => el.closest('[inert]') === null)).toEqual([]);
    // Focus somehow outside (a click jsdom doesn't block): the next Tab in the dialog brings it back.
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('the page itself does not scroll while a dialog is open; its overflow is put back after', async () => {
    renderShell(makeController().controller);
    const before = root().style.overflow;
    chooseFromMore('About');
    await screen.findByRole('dialog', { name: 'About Kashiro' }, ABOUT_LOADS);
    expect(root().style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(root().style.overflow).toBe(before);
  });

  it('every scroll box in a dialog keeps its overscroll: Settings, About, the palette, Dictionary, Report a bug', async () => {
    expect(CONTAINED).toContain('.dialog');
    renderShell(makeController({ dictionary: ['Nashik'] }).controller);
    chooseFromMore('Settings');
    expect(screen.getByRole('dialog').querySelector('.tabpanel')).not.toBeNull();
    expect(uncontained()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    chooseFromMore('About');
    const about = await screen.findByRole('dialog', { name: 'About Kashiro' }, ABOUT_LOADS);
    fireEvent.click(about.querySelector<HTMLButtonElement>('.notice-name')!);
    expect(uncontained()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(document.querySelector('.palette-list')).not.toBeNull();
    expect(uncontained()).toEqual([]);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    chooseFromMore('Dictionary…');
    expect(uncontained()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    chooseFromMore('Report a bug…');
    await screen.findByDisplayValue(/Kashiro bug report/);
    expect(uncontained()).toEqual([]);
  });

  it('the review keys do nothing behind a dialog', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const title = () => reviewPanel().querySelector('.card-title')?.textContent;
    const shown = title();
    const decided = controller.getState().session!.decisionCount();
    chooseFromMore('Settings');
    for (const key of ['j', 'k', 'Enter', 'Backspace', 'Delete']) fireEvent.keyDown(reviewPanel(), { key });
    expect(title()).toBe(shown);
    expect(controller.getState().session!.decisionCount()).toBe(decided);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
  });
});
