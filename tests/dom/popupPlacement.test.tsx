/**
 * Task F20 item 7 (owner found it): the review card's Dismiss ▾ menu opened towards the end edge and ran past the
 * review panel; its items were cut ("All “Formatting” suggestic…") and the panel scrolled sideways. F17 fixed only
 * the toolbar's ⋯ menu, with CSS. Now every popup measures its anchor and the box that clips it when it opens (and
 * on a resize): it opens towards the side that fits, upwards when there is no room below, and is never wider than
 * the room it has. And only one popup is open at a time: opening one closes the others; a click or focus outside
 * closes it; Escape closes it and returns focus to its button.
 * jsdom has no layout, so getBoundingClientRect is mocked per element.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DismissMenu } from '@/ui/DismissMenu';
import { MoreMenu } from '@/ui/MoreMenu';
import { Toolbar } from '@/ui/Toolbar';
import { createTranslator } from '@/ui/i18n/translator';
import { TranslatorProvider } from '@/ui/i18n/useT';
import { defaultSettings } from '@/ui/state/settings';
import type { ControllerState, SessionController } from '@/ui/state/sessionController';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const rect = ({ left, top, width, height }: Box): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** The boxes layout would give: the review panel, the menu's anchor and the menu (by class), in a 1,200 × 800 window. */
let boxes: { review: Box; anchor: Box; menu: Box };

const style = document.createElement('style');
beforeAll(() => {
  style.textContent = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
  document.head.append(style);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('review')) return rect(boxes.review);
    if (this.classList.contains('menu')) return rect(boxes.menu);
    if (this.classList.contains('menu-anchor') || this.classList.contains('save-group')) return rect(boxes.anchor);
    return rect({ left: 0, top: 0, width: 0, height: 0 });
  });
});
afterAll(() => {
  style.remove();
  vi.restoreAllMocks();
});
afterEach(() => {
  boxes = { review: { left: 800, top: 40, width: 400, height: 700 }, anchor: { left: 820, top: 100, width: 90, height: 30 }, menu: { left: 0, top: 0, width: 280, height: 120 } };
});
boxes = { review: { left: 800, top: 40, width: 400, height: 700 }, anchor: { left: 820, top: 100, width: 90, height: 30 }, menu: { left: 0, top: 0, width: 280, height: 120 } };

/** A Dismiss ▾ menu inside the review panel, opened; returns the menu's inline placement. */
function openDismiss(dir: 'ltr' | 'rtl' = 'ltr') {
  render(
    <div dir={dir}>
      <aside className="review">
        <DismissMenu kind="Formatting" thisOneLabel="This one" onThisOne={() => {}} onRule={() => {}} />
      </aside>
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss ▾' }));
  return screen.getByRole('menu');
}

const placement = (menu: HTMLElement) => ({
  start: menu.style.insetInlineStart,
  end: menu.style.insetInlineEnd,
  top: menu.style.top,
  bottom: menu.style.bottom,
  maxWidth: menu.style.maxWidth,
});

describe('a popup opens inside the box that clips it (Task F20 item 7)', () => {
  it('with room on both sides it opens towards the end, below its button', () => {
    expect(placement(openDismiss())).toMatchObject({ start: '0px', end: 'auto', top: '100%', bottom: 'auto' });
  });

  it('an anchor near the panel\'s end edge opens towards the start', () => {
    boxes.anchor = { left: 1080, top: 100, width: 90, height: 30 };
    expect(placement(openDismiss())).toMatchObject({ start: 'auto', end: '0px' });
  });

  it('in a right-to-left layout the same anchor near the end edge (now the left) opens towards the start', () => {
    boxes.anchor = { left: 830, top: 100, width: 90, height: 30 };
    expect(placement(openDismiss('rtl'))).toMatchObject({ start: 'auto', end: '0px' });
  });

  it('an anchor near the bottom opens upwards', () => {
    boxes.anchor = { left: 820, top: 690, width: 90, height: 30 };
    expect(placement(openDismiss())).toMatchObject({ top: 'auto', bottom: '100%' });
  });

  it('is never wider than the room it has: its width is capped and its text wraps', () => {
    boxes.review = { left: 900, top: 40, width: 260, height: 700 };
    boxes.anchor = { left: 980, top: 100, width: 90, height: 30 };
    // 260 px of panel: 180 px to the end edge, 170 px to the start edge; the menu wants 280.
    expect(placement(openDismiss())).toMatchObject({ start: '0px', end: 'auto', maxWidth: '172px' });
  });

  it('measures again when the window is resized while it is open', () => {
    const menu = openDismiss();
    expect(menu.style.insetInlineStart).toBe('0px');
    boxes.anchor = { left: 1080, top: 100, width: 90, height: 30 };
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(menu.style.insetInlineEnd).toBe('0px');
    expect(menu.style.insetInlineStart).toBe('auto');
  });

  it('the review panel never scrolls sideways', () => {
    render(<aside className="review" />);
    expect(getComputedStyle(document.querySelector('.review')!).overflowX).toBe('hidden');
  });
});

/** The toolbar with its ⋯ and Save ▾ menus, and a review card's Dismiss ▾ menu. */
function renderAll() {
  const state = { session: null, settings: defaultSettings('en-US'), variantOverride: null, document: null } as unknown as ControllerState;
  const noop = () => {};
  render(
    <TranslatorProvider translator={createTranslator('en', ['en-IN'])}>
      <Toolbar controller={{} as SessionController} state={state} onOpen={noop} onPaste={noop} onSettings={noop} onHelp={noop} onShortcuts={noop} onAbout={noop} onClose={noop} onLookUp={null} onImprove={null} />
      <aside className="review">
        <DismissMenu kind="Formatting" thisOneLabel="This one" onThisOne={noop} onRule={noop} />
        <button>Outside</button>
      </aside>
    </TranslatorProvider>,
  );
  const save = document.querySelector<HTMLDetailsElement>('.save-menu')!;
  return {
    more: () => screen.getByRole('button', { name: 'More' }),
    dismiss: () => screen.getByRole('button', { name: 'Dismiss ▾' }),
    save,
    summary: save.querySelector('summary')!,
    openMenus: () => screen.queryAllByRole('menu').length + (save.open ? 1 : 0),
  };
}

describe('only one popup is open at a time (Task F20 item 7)', () => {
  it('opening Save ▾ closes ⋯, and opening ⋯ closes Save ▾', () => {
    const ui = renderAll();
    fireEvent.click(ui.more());
    expect(ui.more().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(ui.summary);
    expect(ui.save.open).toBe(true);
    expect(ui.more().getAttribute('aria-expanded')).toBe('false');
    expect(ui.openMenus()).toBe(1);
    fireEvent.click(ui.more());
    expect(ui.save.open).toBe(false);
    expect(ui.openMenus()).toBe(1);
  });

  it('opening Dismiss ▾ closes ⋯, and opening ⋯ closes Dismiss ▾', () => {
    const ui = renderAll();
    fireEvent.click(ui.more());
    fireEvent.click(ui.dismiss());
    expect(ui.more().getAttribute('aria-expanded')).toBe('false');
    expect(ui.dismiss().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(ui.more());
    expect(ui.dismiss().getAttribute('aria-expanded')).toBe('false');
    expect(ui.openMenus()).toBe(1);
  });

  it.each(['more', 'dismiss', 'save'] as const)('%s: a click outside closes it', (which) => {
    const ui = renderAll();
    fireEvent.click(which === 'save' ? ui.summary : ui[which]());
    expect(ui.openMenus()).toBe(1);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(ui.openMenus()).toBe(0);
  });

  it.each(['more', 'dismiss', 'save'] as const)('%s: focus moving outside closes it', (which) => {
    const ui = renderAll();
    fireEvent.click(which === 'save' ? ui.summary : ui[which]());
    fireEvent.focusIn(screen.getByRole('button', { name: 'Outside' }));
    expect(ui.openMenus()).toBe(0);
  });

  it.each(['more', 'dismiss', 'save'] as const)('%s: Escape closes it and returns focus to its button', (which) => {
    const ui = renderAll();
    const button = which === 'save' ? ui.summary : ui[which]();
    fireEvent.click(button);
    const inside = which === 'save' ? ui.save.querySelector('input')! : screen.getByRole('menu');
    fireEvent.keyDown(inside, { key: 'Escape' });
    expect(ui.openMenus()).toBe(0);
    expect(document.activeElement).toBe(button);
  });

  it('the ⋯ menu alone still works as before', () => {
    render(<MoreMenu items={[{ label: 'Settings', onChoose: () => {} }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Settings' }));
  });
});
