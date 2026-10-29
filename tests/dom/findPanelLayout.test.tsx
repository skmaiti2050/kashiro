/**
 * Task F27 item 1 (controller's browser pass): at the 760×480 minimum window the Find panel took about 190 px of the
 * document pane, in six rows, and "Regular expression" wrapped away from its checkbox. Measured in Chrome after the fix
 * (document pane 372 px wide): read-only 2 rows, 79 px; editable 3 rows, 122 px; English and Hindi labels alike.
 * jsdom has no layout, so these check the rules that make those rows, read from app.css and a11y.css as the app loads
 * them, and the panel's parts in both kinds of document.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { findInDocument, findPhrases } from '@/ui/findInDocument';
import { translatorFor } from '@/ui/i18n/translatorFor';

const CSS = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
const style = document.createElement('style');
beforeAll(() => {
  style.textContent = CSS;
  document.head.append(style);
});
afterAll(() => style.remove());

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
});

/** The declarations of the first rule whose whole selector is `selector` (at the start of a line, not after a ","). */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)(?<!,\\n)${escaped} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
}

/** An editor in the app's `.editor` box with its Find panel open; read-only like an opened .docx, or editable. */
function openPanel(readOnly: boolean): HTMLElement {
  const box = document.createElement('main');
  box.className = 'editor';
  document.body.append(box);
  view = new EditorView({
    parent: box,
    state: EditorState.create({
      doc: 'The water is cold.',
      extensions: [findInDocument, findPhrases(translatorFor('en')), EditorState.readOnly.of(readOnly), EditorView.contentAttributes.of({ 'aria-label': 'Document' })],
    }),
  });
  openSearchPanel(view);
  return box.querySelector<HTMLElement>('.cm-panel.cm-search')!;
}

const PANEL = '.editor .cm-editor .cm-panel.cm-search';

describe('the Find panel wraps in whole rows at the minimum window (F27 item 1)', () => {
  // Not nowrap, as the brief suggested: the pseudo-locale check (Task L1) keeps UI text off one line. A flex label holds
  // its checkbox and text together and moves to the next row whole; measured in Chrome, a 152 px pane wrapped
  // "Regular expression" inside its label, beside the checkbox.
  it('each option label keeps its checkbox with it: an inline flex box, a unit of its own', () => {
    const label = rule(`${PANEL} label`);
    expect(label).toMatch(/display: inline-flex;[^}]*align-items: center;/);
    expect(label).not.toMatch(/white-space: (?:pre|nowrap)/);
    const panel = openPanel(true);
    for (const l of panel.querySelectorAll('label')) {
      expect(getComputedStyle(l).display).toBe('inline-flex');
      expect(l.firstElementChild?.matches('input[type="checkbox"]')).toBe(true);
    }
  });

  it('a wrapping row with tight gaps; CodeMirror’s per-control margins are gone', () => {
    const panel = rule(PANEL);
    expect(panel).toMatch(/display: flex;[^}]*flex-wrap: wrap;/);
    expect(panel).toMatch(/gap: 6px;/);
    expect(panel).toMatch(/padding: 6px 8px;/);
    expect(rule(`${PANEL} > *`)).toMatch(/margin: 0;/);
    // The old panel kept 56 px at the end of every row for the close button.
    expect(panel).not.toMatch(/56px/);
  });

  it('the rows: find and its buttons with Close (order 0-1), a break (2), the options (3), a break (4), Replace (5)', () => {
    expect(rule(`${PANEL} [name='close']`)).toMatch(/position: static;[^}]*order: 1;[^}]*margin-inline-start: auto;/);
    expect(rule(`${PANEL}::after`)).toMatch(/content: '';[^}]*order: 2;[^}]*flex-basis: 100%;[^}]*height: 0;/);
    expect(rule(`${PANEL} label`)).toMatch(/order: 3;/);
    // The second break only where there is a Replace row (an editable document).
    expect(rule(`${PANEL}:has([name='replaceAll'])::before`)).toMatch(/content: '';[^}]*order: 4;[^}]*flex-basis: 100%;[^}]*height: 0;/);
    expect(CSS).toMatch(/\.editor \.cm-editor \.cm-panel\.cm-search \[name='replace'\],\n\.editor \.cm-editor \.cm-panel\.cm-search \[name='replaceAll'\] \{\s*order: 5;/);
    expect(rule(`${PANEL} br`)).toMatch(/display: none;/);
  });

  it('the field takes what its row leaves: from 6em, up to 24em', () => {
    const field = rule(`${PANEL} .cm-textfield`);
    expect(field).toMatch(/flex: 1 1 6em;/);
    expect(field).toMatch(/min-width: 6em;/);
    expect(field).toMatch(/max-width: 24em;/);
  });

  it('read-only: Find, Next, Previous, Select all, the three options and Close; no Replace row', () => {
    const panel = openPanel(true);
    expect([...panel.children].map((c) => c.getAttribute('name') ?? c.tagName.toLowerCase())).toEqual(['search', 'next', 'prev', 'select', 'label', 'label', 'label', 'close']);
    expect(getComputedStyle(panel.querySelector('[name="close"]')!).position).toBe('static');
  });

  it('editable: the Replace row follows the options, its field and buttons in order 5', () => {
    const panel = openPanel(false);
    expect([...panel.children].map((c) => c.getAttribute('name') ?? c.tagName.toLowerCase())).toEqual(['search', 'next', 'prev', 'select', 'label', 'label', 'label', 'br', 'replace', 'replace', 'replaceAll', 'close']);
    for (const el of panel.querySelectorAll('[name="replace"], [name="replaceAll"]')) expect(getComputedStyle(el).order).toBe('5');
    expect(getComputedStyle(panel.querySelector('br')!).display).toBe('none');
  });
});
