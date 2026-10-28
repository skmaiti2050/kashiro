import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { CheckSession, Outcome } from '@/engine/session';
import type { Candidate } from '@/engine/types';
import { ChangeLog } from '@/ui/ChangeLog';
import { createTranslator } from '@/ui/i18n/translator';
import { TranslatorProvider } from '@/ui/i18n/useT';
import type { ControllerState, SessionController } from '@/ui/state/sessionController';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

// Task F19: "Reject all" on a 600-fix card made the whole page scroll 24,536 px into blank space. The change log's
// screen-reader "1 space" text is `position: absolute`, and its scrolling list wasn't positioned, so the text's
// containing block was the page: it sat far down the scrolled list, escaped the list's clipping and grew the page.
// jsdom has no layout, so the checks are on the app's real CSS: what keeps such text inside the box that clips it.

const APP_CSS = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
const style = document.createElement('style');
beforeAll(() => {
  style.textContent = APP_CSS;
  document.head.append(style);
});
afterAll(() => style.remove());

/** A box that clips what overflows it ("auto", "scroll" or "hidden"). */
const clips = (box: Element) => [getComputedStyle(box).overflow, getComputedStyle(box).overflowY].some((value) => /auto|scroll|hidden/.test(value));
const isPositioned = (box: Element) => !['', 'static'].includes(getComputedStyle(box).position);

/**
 * The box an absolutely positioned `element` escapes: the nearest ancestor that clips it without containing it,
 * found before any positioned ancestor (which would be its containing block). Null when it stays inside.
 */
function escapedClip(element: Element): Element | null {
  for (let box = element.parentElement; box; box = box.parentElement) {
    if (isPositioned(box)) return null;
    if (clips(box)) return box;
  }
  return null;
}

/** "tag.class.class" for a failure message. */
const describeBox = (box: Element) => [box.tagName.toLowerCase(), ...box.classList].join('.');

/** Each different way a screen-reader-only text on the page escapes a box ('"1 space" escapes ol.entries'). */
function hiddenTextEscapes(): string[] {
  const hidden = [...document.querySelectorAll('.visually-hidden')];
  expect(hidden.length).toBeGreaterThan(0);
  for (const element of hidden) expect(getComputedStyle(element).position).toBe('absolute');
  const escapes = hidden.flatMap((element) => {
    const box = escapedClip(element);
    return box ? [`"${element.textContent}" escapes ${describeBox(box)}`] : [];
  });
  return [...new Set(escapes)];
}

describe('every scrolling box contains its absolutely positioned content (Task F19)', () => {
  /** The top-level rules of the app's CSS that make a box scroll (not those inside @media or @supports). */
  const scrollingSelectors = () =>
    [...style.sheet!.cssRules]
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
      .filter((rule) => [rule.style.overflow, rule.style.overflowY].some((value) => /auto|scroll/.test(value)))
      .flatMap((rule) => rule.selectorText.split(',').map((selector) => selector.trim()));

  /** Elements nested as a descendant selector of classes names them (".changelog .entries"); the innermost. */
  function elementFor(selector: string): Element {
    let parent: Element = document.body;
    for (const part of selector.split(/\s+/)) {
      expect(part, `the check builds only class selectors, not "${selector}"`).toMatch(/^(\.[\w-]+)+$/);
      const box = document.createElement('div');
      box.className = part.split('.').filter(Boolean).join(' ');
      parent = parent.appendChild(box);
    }
    return parent;
  }

  it('finds the app scrolling boxes', () => {
    expect(scrollingSelectors()).toEqual(expect.arrayContaining(['.review', '.changelog .entries', '.dialog']));
  });

  it('each one is positioned, so text inside it is clipped and scrolled with it instead of growing the page', () => {
    const unpositioned = scrollingSelectors().filter((selector) => {
      const element = elementFor(selector);
      const positioned = isPositioned(element);
      document.body.replaceChildren();
      return !positioned;
    });
    expect(unpositioned).toEqual([]);
  });
});

/** A spacing fix "apply all" made: drawn "··" → "·" with "2 spaces" → "1 space" for screen readers. */
function spacingFix(i: number): Outcome {
  const candidate: Candidate = { id: `s${i}`, paraId: i, span: { start: 7, end: 9 }, original: '  ', replacements: [' '], kind: 'Formatting', message: '', source: 'rules' };
  return { candidate, paragraphNumber: i + 1, status: 'rejected', auto: false, replacement: ' ', batch: undefined };
}

describe('screen-reader text stays inside the box that clips it (Task F19)', () => {
  it('a long change log of spacing fixes: each "1 space" stays inside the scrolling list', () => {
    const outcomes = Array.from({ length: 600 }, (_, i) => spacingFix(i));
    const session = { outcomes: () => outcomes, paragraphs: () => outcomes.map((_, i) => ({ id: i, text: 'We went  home today.' })) } as unknown as CheckSession;
    render(
      <TranslatorProvider translator={createTranslator('en', ['en-IN'])}>
        <ChangeLog controller={{} as SessionController} state={{ session } as ControllerState} open onToggle={() => {}} />
      </TranslatorProvider>,
    );
    expect(document.querySelectorAll('.entries .visually-hidden')).toHaveLength(1200);
    expect(hiddenTextEscapes()).toEqual([]);
  });

  it('the app: its announcers and the flag under the cursor stay inside their boxes', async () => {
    await warmLinter();
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    expect(document.getElementById('flag-at-cursor')).not.toBeNull();
    expect(hiddenTextEscapes()).toEqual([]);
  }, 30000);
});
