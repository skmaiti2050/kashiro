/**
 * Task F21b (owner's UI wishes, F21 list items 2, 3, 7 and 8): the review panel's help area spacing, modern native
 * form controls, a visible resting shape on every quiet button, and styled selects. Read from app.css and a11y.css
 * as the app loads them, as panelWidth.test.tsx does.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const CSS = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');

/** A box built from `classes` nested in order ("review" > "read-aloud"), returned innermost. */
function build(...classes: string[]): HTMLElement {
  let parent: HTMLElement = document.body;
  for (const name of classes) {
    const el = document.createElement('div');
    el.className = name;
    parent.append(el);
    parent = el;
  }
  return parent;
}

const style = document.createElement('style');
beforeAll(() => {
  style.textContent = CSS;
  document.head.append(style);
});
afterAll(() => style.remove());

/** The colour tokens of a theme: `:root { … }` for light, `:root[data-theme='dark'] { … }` for dark. */
function tokens(theme: 'light' | 'dark'): Record<string, string> {
  const block = theme === 'light' ? /:root \{([^}]*)\}/.exec(CSS)![1] : /:root\[data-theme='dark'\] \{([^}]*)\}/.exec(CSS)![1];
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
}

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** A <button> with `className`, in the page. */
function button(className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  document.body.append(b);
  return b;
}

describe('every button has a visible shape at rest, not only on hover (item 5, F21 list item 7)', () => {
  it.each(['light', 'dark'] as const)('%s: the control edge has at least 3:1 against the panel and the page', (theme) => {
    const t = tokens(theme);
    expect(contrast(t['--control-edge'], t['--panel'])).toBeGreaterThanOrEqual(3);
    expect(contrast(t['--control-edge'], t['--bg'])).toBeGreaterThanOrEqual(3);
  });

  // jsdom can't read a border shorthand that holds var(), so these read the rules themselves.
  it.each(['button', 'button.quiet', '.save-menu summary'])('%s: the control edge is its border at rest', (selector) => {
    expect(rule(selector)).toMatch(/border(?:-color)?: (?:1px solid )?var\(--control-edge\);/);
    expect(rule(selector)).not.toMatch(/border-color: transparent/);
  });

  it('menu items and text links keep no border: the menu or the underline is their shape', () => {
    const item = document.createElement('button');
    build('menu-anchor', 'menu').append(item);
    expect(getComputedStyle(item).borderTopStyle).toBe('none');
    expect(getComputedStyle(button('link')).borderTopStyle).toBe('none');
  });
});

describe('styled selects, still the native element (item 6, F21 list item 8)', () => {
  it('the control edge, room for a chevron drawn in the text colour, and padding', () => {
    const select = rule('select');
    expect(select).toMatch(/appearance: none;/);
    expect(select).toMatch(/border: 1px solid var\(--control-edge\);/);
    expect(select).toMatch(/background-image:[^;]*currentColor/);
    expect(select).toMatch(/padding-inline: 8px 28px;/);
  });

  it('the chevron sits at the end in either direction', () => {
    expect(rule("[dir='rtl'] select")).toMatch(/background-position:[^;]*left/);
  });

  it('a toolbar chip (Goal, variant) shows the edge on the chip, and its select keeps the chevron', () => {
    expect(rule('.chip')).toMatch(/border: 1px solid var\(--control-edge\);/);
    expect(rule('.chip select')).not.toMatch(/background: transparent/);
  });

  it('a Windows contrast theme gets the system’s own select back', () => {
    const forced = CSS.slice(CSS.lastIndexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/select \{[^}]*appearance: auto;[^}]*background-image: none;/);
  });
});

/** The declarations of the first rule whose whole selector is `selector` (at the start of a line, not after a ","). */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)(?<!,\\n)${escaped} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
}

describe('the review panel’s help area (item 2)', () => {
  it('the key legend keeps the same gap below the read-aloud row as the other rows: no negative margin pulls it up', () => {
    expect(getComputedStyle(build('key-legend')).marginTop).toBe('0px');
    expect(getComputedStyle(build('read-aloud')).marginBottom).toBe('12px');
  });

  it('the read-aloud row is a label and a wrapping group of buttons, so a wrapped button lines up under the first', () => {
    const row = getComputedStyle(build('read-aloud'));
    expect(row.display).toBe('grid');
    expect(row.gridTemplateColumns).toBe('auto minmax(0, 1fr)');
    const buttons = getComputedStyle(build('read-aloud', 'read-aloud-buttons'));
    expect(buttons.display).toBe('flex');
    expect(buttons.flexWrap).toBe('wrap');
  });
});
