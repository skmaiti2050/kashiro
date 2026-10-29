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

describe('checkboxes, radios and sliders: native inputs drawn in the theme (item 3)', () => {
  it('the theme accent is every input’s accent colour', () => {
    expect(rule('input')).toMatch(/accent-color: var\(--accent\);/);
  });

  it('a checkbox or radio at rest: the control edge on the panel, and a 24 px target with its margin', () => {
    expect(CSS).toMatch(/input\[type='checkbox'\],\ninput\[type='radio'\] \{[^}]*appearance: none;[^}]*border: 1px solid var\(--control-edge\);/);
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.append(box);
    const size = getComputedStyle(box);
    expect([size.width, size.height, size.marginTop]).toEqual(['18px', '18px', '3px']);
    expect(rule("input[type='radio']")).toMatch(/border-radius: 50%;/);
  });

  it('checked: a filled accent box with a check in the accent’s ink; a radio gets an accent ring and dot', () => {
    expect(rule("input[type='checkbox']:checked")).toMatch(/background-color: var\(--accent\);[^}]*border-color: var\(--accent\);/);
    expect(rule("input[type='checkbox']::before")).toMatch(/background: var\(--accent-ink\);/);
    expect(rule("input[type='checkbox']::before")).toMatch(/clip-path: polygon/);
    expect(rule("input[type='radio']:checked")).toMatch(/border-color: var\(--accent\);/);
    expect(rule("input[type='radio']::before")).toMatch(/background: var\(--accent\);/);
    expect(CSS).toMatch(/input\[type='checkbox'\]:checked::before,\ninput\[type='radio'\]:checked::before \{\s*transform: scale\(1\);/);
  });

  it('a slider: a slim track in the control edge and a larger accent thumb', () => {
    expect(rule("input[type='range']")).toMatch(/appearance: none;/);
    expect(rule("input[type='range']::-webkit-slider-runnable-track")).toMatch(/height: 4px;[^}]*background: var\(--control-edge\);/);
    expect(rule("input[type='range']::-webkit-slider-thumb")).toMatch(/width: 18px;[^}]*height: 18px;[^}]*background: var\(--accent\);/);
    expect(rule("input[type='range']::-moz-range-thumb")).toMatch(/background: var\(--accent\);/);
  });

  it('a Windows contrast theme gets the system’s own checkboxes, radios and sliders back', () => {
    const forced = CSS.slice(CSS.lastIndexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/input\[type='checkbox'\],\s*input\[type='radio'\],\s*input\[type='range'\] \{\s*appearance: auto;/);
    expect(forced).toMatch(/input::before \{\s*display: none;/);
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
