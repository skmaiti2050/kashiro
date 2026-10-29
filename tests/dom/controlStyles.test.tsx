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
