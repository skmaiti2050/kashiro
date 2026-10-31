import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CheckSession, Outcome } from '@/engine/session';
import type { Candidate } from '@/engine/types';
import { ChangeLog } from '@/ui/ChangeLog';
import { createTranslator } from '@/ui/i18n/translator';
import { TranslatorProvider } from '@/ui/i18n/useT';
import type { ControllerState, SessionController } from '@/ui/state/sessionController';

const TEXT = 'I think teh plan works. The cat of of mine ate a apple today.';

/** A change "apply all" made to the first `original` in `text` (or the one at `at`). */
const applied = (id: string, original: string, replacement: string, kind: string, text = TEXT, at = text.indexOf(original)): Outcome => {
  const candidate: Candidate = { id, paraId: 0, span: { start: at, end: at + original.length }, original, replacements: [replacement], kind, message: '', source: 'rules' };
  return { candidate, paragraphNumber: 1, status: 'applied', auto: false, replacement, batch: 'batch-1' };
};

/** The log with every batch row opened (collapsed by default since Task F20), so each change is shown. */
function renderLog(outcomes: Outcome[], text = TEXT, language: 'en' | 'hi' | 'bn' = 'en') {
  const session = { outcomes: () => outcomes, paragraphs: () => [{ id: 0, text }] } as unknown as CheckSession;
  const result = render(
    <TranslatorProvider translator={createTranslator(language, ['en-IN'])}>
      <ChangeLog controller={{} as SessionController} state={{ session } as ControllerState} open onToggle={() => {}} />
    </TranslatorProvider>,
  );
  result.container.querySelectorAll('.batch-toggle').forEach((button) => fireEvent.click(button));
  return result;
}

const CARD = [applied('t', 'teh', 'the', 'Typo'), applied('o', 'of of', 'of', 'Repetition'), applied('a', 'a', 'an', 'Miscellaneous', TEXT, TEXT.indexOf(' a apple') + 1)];

describe('ChangeLog: one row for the simple-fixes card (Task F4)', () => {
  it('names every kind the card applied, not only the first', () => {
    renderLog(CARD);
    expect(screen.getByText('3 fixes (Typos, Repeated words, Other) applied together')).toBeTruthy();
  });

  it('lists every change the card made, not only the first (F4 re-review 3, M-7)', () => {
    const { container } = renderLog(CARD);
    const changes = [...container.querySelectorAll('li.batch .change')].map((c) => `${c.querySelector('del')!.textContent} → ${c.querySelector('ins')!.textContent}`);
    expect(changes).toEqual(['teh → the', 'of of → of', 'a → an']);
  });

  it('shows each change with a few words around it, cut at whole words (F5 re-review 4, M-6)', () => {
    const { container } = renderLog(CARD);
    const changes = [...container.querySelectorAll('li.batch .change')].map((c) => c.textContent);
    expect(changes).toEqual(['I think teh → the plan works.…', '…The cat of of → of mine ate a…', '…of mine ate a → an apple…']);
  });

  it('draws a spacing change instead of leaving it blank, and says it to screen readers', () => {
    const text = 'We went  home today.';
    const { container } = renderLog([applied('s', '  ', ' ', 'Formatting', text)], text);
    const [del, ins] = [container.querySelector('.change del')!, container.querySelector('.change ins')!];
    expect(del.querySelector('[aria-hidden="true"]')!.textContent).toBe('··');
    expect(ins.querySelector('[aria-hidden="true"]')!.textContent).toBe('·');
    expect(del.querySelector('.visually-hidden')!.textContent).toBe('2 spaces');
    expect(ins.querySelector('.visually-hidden')!.textContent).toBe('1 space');
    expect(container.querySelector('.change')!.textContent).toContain('We went');
  });

  it.each([
    ['hi', '2 स्पेस'],
    ['bn', '2টি স্পেস'],
  ] as const)('%s: names the spaces', (language, said) => {
    const text = 'We went  home today.';
    const { container } = renderLog([applied('s', '  ', ' ', 'Formatting', text)], text, language);
    expect(container.querySelector('.change del .visually-hidden')!.textContent).toBe(said);
  });

  it('names invisible and direction characters in the context, as in the change (F6 re-review 5, M-5)', () => {
    const text = 'We saw\u{200B} it, \u{202E}so the the cat ran.';
    const { container } = renderLog([applied('d', 'the the', 'the', 'Repetition', text)], text);
    const context = [...container.querySelectorAll('.change .context')].map((c) => c.textContent).join(' | ');
    expect(context).toBe('…it, ‹U+202E›so  |  cat ran.');
    const zwsp = 'mod\u{200B}els the the cat';
    const { container: other } = renderLog([applied('d', 'the the', 'the', 'Repetition', zwsp)], zwsp);
    expect(other.querySelector('.change .context')!.textContent).toBe('mod‹U+200B›els ');
  });

  it('isolates the context and the change, so a direction character cannot reorder the row (F6 re-review 5, M-5)', () => {
    const { container } = renderLog(CARD);
    const pieces = [...container.querySelectorAll('.change .context, .change del > *, .change ins > *')];
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.filter((p) => p.tagName !== 'BDI')).toEqual([]);
  });

  it.each([
    ['हम the the बाजार गए।', 'hi'],
    ['আমরা the the বাজারে গেলাম।', 'bn'],
    ['We saw the the cat.', 'en'],
  ])('marks the context of "%s" as lang="%s", and the English change as "en" (F6 re-review 5, M-5)', (text, lang) => {
    const { container } = renderLog([applied('d', 'the the', 'the', 'Repetition', text)], text);
    const contexts = [...container.querySelectorAll('.change .context')];
    expect(contexts.map((c) => c.getAttribute('lang'))).toEqual([lang, lang]);
    expect(container.querySelector('.change del > *')!.getAttribute('lang')).toBe('en');
  });

  it.each([
    ['क्\u{200D}ष the the cat', 'क्\u{200D}ष '],
    ['क्\u{200C}ष the the cat', 'क्\u{200C}ष '],
    // Bengali "RAB": ra, ZWJ, virama, ya, aa, ba.
    ['\u{09B0}\u{200D}\u{09CD}\u{09AF}\u{09BE}\u{09AC} the the cat', '\u{09B0}\u{200D}\u{09CD}\u{09AF}\u{09BE}\u{09AC} '],
  ])('shows a joiner inside a Hindi or Bengali word of the context as itself, not as a code: "%s" (F7 re-review 6, M-3)', (text, before) => {
    const { container } = renderLog([applied('d', 'the the', 'the', 'Repetition', text)], text);
    expect(container.querySelector('.change .context')!.textContent).toBe(before);
    expect(container.querySelector('.change')!.textContent).not.toContain('U+');
  });

  it.each([
    // The ZWJs of a family emoji, and the selector of an emoji, are parts of the sequence, as hygiene keeps them.
    ['👨\u{200D}👩\u{200D}👧\u{200D}👦 the the cat', '👨\u{200D}👩\u{200D}👧\u{200D}👦 '],
    ['☺\u{FE0F} the the cat', '☺\u{FE0F} '],
    ['❤\u{FE0F} the the cat', '❤\u{FE0F} '],
  ])('shows an emoji sequence of the context as itself, not as a code: "%s"', (text, before) => {
    const { container } = renderLog([applied('d', 'the the', 'the', 'Repetition', text)], text);
    expect(container.querySelector('.change .context')!.textContent).toBe(before);
    expect(container.querySelector('.change')!.textContent).not.toContain('U+');
  });

  it.each([
    // A joiner outside an Indic word, between two scripts, or at the context's edge, a direction control, and a
    // selector not after an emoji.
    ['a\u{200D}b the the cat', 'a‹U+200D›b '],
    ['क\u{200D}b the the cat', 'क‹U+200D›b '],
    ['क्\u{200D}the the cat', 'क्‹U+200D›'],
    ['क\u{202E}ष the the cat', 'क‹U+202E›ष '],
    ['a\u{FE0F}b the the cat', 'a‹U+FE0F›b '],
  ])('still names other invisible characters in the context: "%s" (F7 re-review 6, M-3)', (text, before) => {
    const { container } = renderLog([applied('d', 'the the', 'the', 'Repetition', text)], text);
    expect(container.querySelector('.change .context')!.textContent).toBe(before);
  });

  it('still names a joiner that is part of the change itself (F7 re-review 6, M-3)', () => {
    const text = 'यह क्\u{200D}षमा है।';
    const original = 'क्\u{200D}षमा';
    const { container } = renderLog([applied('w', original, 'क्षमा', 'Typo', text)], text);
    expect(container.querySelector('.change del')!.textContent).toBe('क्‹U+200D›षमा');
  });

  it('names an invisible character it deleted', () => {
    const text = 'mod\u{200B}els here';
    const { container } = renderLog([{ ...applied('z', '\u{200B}', '', 'Invisible', text), auto: true, batch: undefined }], text);
    expect(container.querySelector('.change del')!.textContent).toBe('‹U+200B›');
  });
});

describe('ChangeLog: a card blocked by a restored invisible character (#9)', () => {
  const blocked = (): Outcome => ({
    ...applied('r', 'recie\u{200B}ved', 'received', 'Spelling', 'We recie\u{200B}ved it.'),
    status: 'rejected',
    batch: undefined,
    unplaceable: 'it would delete an invisible character you restored',
  });

  it.each([
    ['en', 'it would delete an invisible character you restored'],
    ['hi', 'आपका वापस रखा हुआ अदृश्य अक्षर हट जाएगा'],
    ['bn', 'আপনার ফিরিয়ে রাখা অদৃশ্য অক্ষরটি মুছে যাবে'],
  ] as const)('%s: shows the translated reason, not the raw engine text', (language, said) => {
    const { container } = renderLog([blocked()], 'We recie\u{200B}ved it.', language);
    const text = container.querySelector('.entries li')!.textContent!;
    expect(text).toContain(said);
    expect(text).not.toContain('unplaceable:');
    if (language !== 'en') expect(text).not.toContain('invisible character you restored');
  });
});

/** The column sizes of a grid ("48px minmax(0, 1fr) auto" → ["48px", "minmax(0, 1fr)", "auto"]). */
const gridTracks = (template: string) => template.match(/[\w.-]+\([^)]*\)|\S+/g) ?? [];

describe('ChangeLog: a long change or context wraps inside its row (F7 re-review 6, M-4)', () => {
  // jsdom has no layout, so the check is on the app's real CSS: what lets the row wrap instead of widen.
  const style = document.createElement('style');
  beforeAll(() => {
    style.textContent = readFileSync('src/ui/app.css', 'utf8') + readFileSync('src/ui/a11y.css', 'utf8');
    document.head.append(style);
  });
  afterAll(() => style.remove());

  it.each([
    ['a run of named invisible characters', `${'\u{200B}'.repeat(12)}the the cat`],
    ['one long unbroken word', `${'x'.repeat(200)} the the cat`],
  ])('%s may break anywhere, and the text column may shrink below its content', (_name, text) => {
    const { container } = renderLog([{ ...applied('d', 'the the', 'the', 'Repetition', text), batch: undefined }], text);
    for (const piece of container.querySelectorAll('.change, .change .context')) expect(getComputedStyle(piece).overflowWrap).toBe('anywhere');
    const row = container.querySelector('.entries li')!;
    expect(gridTracks(getComputedStyle(row).gridTemplateColumns)[1]).toBe('minmax(0, 1fr)');
  });

  // At the 760 px minimum window an `auto` status column took its whole one-line width first and left the changes
  // 0 px wide (F8 re-review 7, M-3). fit-content(40%) caps it, so the status wraps and the changes keep the rest.
  it.each([
    ['a batch row with six kinds', CARD.concat(['Spelling', 'Capitalization', 'Punctuation'].map((kind, i) => applied(`k${i}`, 'plan', 'plan', kind)))],
    ['a single row', [{ ...applied('d', 'of of', 'of', 'Repetition'), batch: undefined }]],
  ])('%s: a long status wraps inside at most 40 per cent of the row, and never squeezes the changes to nothing', (_name, outcomes) => {
    const { container } = renderLog(outcomes);
    // A batch row is a header over its lines (Task F20 item 2): each line is laid out like a single row.
    for (const row of container.querySelectorAll('.entries > li:not(.batch), .batch-changes > li')) {
      expect(gridTracks(getComputedStyle(row).gridTemplateColumns)).toEqual(['48px', 'minmax(0, 1fr)', 'fit-content(40%)', 'auto']);
    }
  });
});
