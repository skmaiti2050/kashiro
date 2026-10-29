/**
 * Task F26 item 1 (owner): in the dark theme the Find panel's Next, Previous, All and Close buttons were blank white
 * boxes. CodeMirror draws its panel buttons with a light gradient (it doesn't know the app is dark) and the text in
 * the app's light ink: white on white. The search field was small (CodeMirror's 70%) on a grey fill. The panel's
 * controls are drawn with the app's tokens now, in both themes and in a Windows contrast theme. Read from app.css and
 * a11y.css as the app loads them (as controlStyles.test.tsx does), with CodeMirror's own theme in the page.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import axe from 'axe-core';
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
  delete document.documentElement.dataset.theme;
});

/** An editable editor in the app's `.editor` box, in `language`, with its Find panel open. */
function openPanel(language: 'en' | 'hi', theme: 'light' | 'dark'): HTMLElement {
  document.documentElement.dataset.theme = theme;
  const box = document.createElement('main');
  box.className = 'editor';
  document.body.append(box);
  const t = translatorFor(language);
  view = new EditorView({
    parent: box,
    state: EditorState.create({ doc: 'The water is cold.', extensions: [findInDocument, findPhrases(t), EditorView.contentAttributes.of({ 'aria-label': 'Document' })] }),
  });
  openSearchPanel(view);
  return box.querySelector<HTMLElement>('.cm-panel.cm-search')!;
}

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

/** The declarations of the first rule whose whole selector is `selector` (at the start of a line, not after a ","). */
function rule(selector: string, css = CSS): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)\\s*(?<!,\\n)${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

const BUTTONS = '.editor .cm-editor .cm-panel.cm-search .cm-button';
const FIELD = '.editor .cm-editor .cm-panel.cm-search .cm-textfield';

describe('the Find panel’s buttons and field, in the app’s theme (F26 item 1)', () => {
  it.each(['light', 'dark'] as const)('%s: no CodeMirror gradient behind the buttons; each has its label as visible text', (theme) => {
    const panel = openPanel('en', theme);
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Next', 'Previous', 'Select all', 'Replace', 'Replace all', '×']);
    for (const b of buttons) expect(getComputedStyle(b).backgroundImage).toBe('none');
  });

  it('the buttons: the panel colour, the ink, the control edge and the app’s size; the hover edge as other buttons', () => {
    const buttons = rule(BUTTONS);
    expect(buttons).toMatch(/background: var\(--panel\);/);
    expect(buttons).toMatch(/background-image: none;/);
    expect(buttons).toMatch(/color: var\(--ink\);/);
    expect(buttons).toMatch(/border: 1px solid var\(--control-edge\);/);
    expect(buttons).toMatch(/font-size: inherit;/);
    expect(rule(`${BUTTONS}:hover`)).toMatch(/border-color: var\(--ink\);/);
  });

  it('the field: full-size text on the panel colour (no grey fill), the control edge, and room to type', () => {
    const field = rule(FIELD);
    expect(field).toMatch(/background: var\(--panel\);/);
    expect(field).toMatch(/color: var\(--ink\);/);
    expect(field).toMatch(/border: 1px solid var\(--control-edge\);/);
    expect(field).toMatch(/font-size: inherit;/);
    expect(field).toMatch(/min-width: 16em;/);
  });

  it('the labels (match case, regexp, by word) are the panel’s size, not CodeMirror’s 80%', () => {
    expect(rule('.editor .cm-editor .cm-panel.cm-search label')).toMatch(/font-size: inherit;/);
  });

  it('nothing takes away the shared focus ring (2 px accent, outside the control)', () => {
    const panelRules = [...CSS.matchAll(/\.cm-search[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join('');
    expect(panelRules).not.toMatch(/outline: (?:none|0)/);
    expect(rule('button:focus-visible,\ninput:focus-visible,\nselect:focus-visible,\nsummary:focus-visible,\n[tabindex]:focus-visible')).toMatch(/outline: 2px solid var\(--accent\);/);
  });

  it.each(['light', 'dark'] as const)('%s: text on the buttons and field is at least 4.5:1, their edge at least 3:1', (theme) => {
    const t = tokens(theme);
    expect(contrast(t['--ink'], t['--panel'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--control-edge'], t['--panel'])).toBeGreaterThanOrEqual(3);
  });

  it('a Windows contrast theme: the system’s button and field colours, no gradient', () => {
    const forced = CSS.slice(CSS.lastIndexOf('@media (forced-colors: active)'));
    expect(rule(BUTTONS, forced)).toMatch(/background: ButtonFace;[^}]*color: ButtonText;[^}]*border-color: ButtonText;/);
    expect(rule(FIELD, forced)).toMatch(/background: Field;[^}]*color: FieldText;[^}]*border-color: FieldText;/);
  });

  it.each(['light', 'dark'] as const)('%s: axe finds nothing serious in the open panel (Hindi labels too)', async (theme) => {
    for (const language of ['en', 'hi'] as const) {
      const panel = openPanel(language, theme);
      const results = await axe.run(panel, { resultTypes: ['violations'] });
      expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
      view?.destroy();
      document.body.replaceChildren();
    }
  });
});
