/**
 * Task F20 item 4 (owner: yes): on a 2,000 px window the review panel stayed at its 380 px, its cards wrapped a lot
 * and the eye travelled from the centred text to the cards. The panel now grows with the window, up to 520 px
 * (times the app text size), never past half the workspace. And every scrolling box keeps its scrollbar's gutter,
 * so opening "More (34)" no longer re-wraps the whole panel when its scrollbar appears.
 * jsdom has no layout, so these check the app's real CSS, as the other CSS tests do.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const CSS = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');

/** The column sizes of a grid ("minmax(0, 1fr) clamp(…)" → ["minmax(0, 1fr)", "clamp(…)"]), nested brackets kept whole. */
function gridTracks(template: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let track = '';
  for (const ch of template) {
    if (ch === ' ' && depth === 0) {
      if (track) tracks.push(track);
      track = '';
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    track += ch;
  }
  if (track) tracks.push(track);
  return tracks;
}

/** A box built from `classes` nested in order ("app" > "workspace"), returned innermost. */
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

describe('the review panel grows with the window on large screens (Task F20 item 4)', () => {
  const style = document.createElement('style');
  beforeAll(() => {
    style.textContent = CSS;
    document.head.append(style);
  });
  afterAll(() => style.remove());

  it('its column is 26 per cent of the window between 380 px and 520 px, times the text size, never past half', () => {
    const tracks = gridTracks(getComputedStyle(build('workspace')).gridTemplateColumns);
    // F23 item 3: the divider's column sits between them, and a width the user chose (--panel-width) replaces the default.
    expect(tracks).toEqual(['minmax(0, 1fr)', 'auto', 'var(--panel-width, clamp(300px, calc(clamp(380px, 26vw, 520px) * var(--ui-zoom, 1)), 50%))']);
  });

  it('the document text keeps its centred 70-character measure', () => {
    const content = getComputedStyle(build('editor', 'cm-content'));
    expect(content.maxWidth).toBe('70ch');
    expect(content.marginLeft).toBe('auto');
    expect(content.marginRight).toBe('auto');
  });

  it.each(['review', 'dialog'])('.%s keeps a stable scrollbar gutter', (name) => {
    expect(getComputedStyle(build(name)).getPropertyValue('scrollbar-gutter')).toBe('stable');
  });

  it.each([
    ['the change log list', ['changelog', 'entries']],
    ['a batch row\'s list', ['changelog', 'batch-changes']],
    ['the editor', ['editor', 'cm-scroller']],
  ])('%s keeps a stable scrollbar gutter', (_name, classes) => {
    expect(getComputedStyle(build(...classes)).getPropertyValue('scrollbar-gutter')).toBe('stable');
  });

  it('the narrow layout (720 px and below) still stacks the panel under the document', () => {
    const narrow = CSS.slice(CSS.indexOf('@media (max-width: 720px)'));
    expect(narrow).toMatch(/\.workspace \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
});
