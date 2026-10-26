/**
 * "Review and apply all" on the simple-fixes card applies its ticked fixes with one click, so a fix starts ticked
 * only when it belongs to a closed, listed set: a doubled word on the allowlist, never next to another fix (Task
 * F6). Every a/an swap stays on the card unticked (Task F8, owner decision 2026-10-26): reviews #4 to #6 each found
 * a new way a ticked one was wrong. Everything else is listed unticked (Task F5's repros stay unticked).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { markdownAdapter } from '@/formats/text';
import type { Paragraph } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts = (over: Partial<CheckOptions> = {}): CheckOptions => ({
  preset: 'blog',
  fallbackVariant: 'Indian',
  language: 'plaintext',
  dictionary: [],
  ...over,
});

/** The session after "Review and apply all" with the card's default ticks, and what started ticked and unticked. */
async function applyAllWithDefaultTicks(paras: Paragraph[], over: Partial<CheckOptions> = {}) {
  const s = await CheckSession.start(paras, opts(over), { linter });
  const card = s.decisions().top.find((d) => d.id === SIMPLE_FIXES_ID);
  const byId = new Map(s.candidates().map((c) => [c.id, c]));
  const shown = (id: string) => `${byId.get(id)!.original} → ${byId.get(id)!.replacements[0]}`;
  const unticked = new Set(card?.startUnticked ?? []);
  const ticked = (card?.candidateIds ?? []).filter((id) => !unticked.has(id));
  if (ticked.length) s.applyBatch(SIMPLE_FIXES_ID, ticked);
  return { session: s, ticked: ticked.map(shown), unticked: [...unticked].map(shown) };
}

const outputOf = async (text: string, over: Partial<CheckOptions> = {}) =>
  (await applyAllWithDefaultTicks([{ id: 0, text }], over)).session.outputText(0);

describe('the simple-fixes card ticks only a closed set of fixes (Task F6, owner decision 2026-10-26)', () => {
  it('ticks a doubled word on the allowlist; lists the rest unticked, the article swap included (Task F8)', async () => {
    const { session, ticked, unticked } = await applyAllWithDefaultTicks([
      { id: 0, text: 'I think teh cat of of mine ate a apple. It rained today. we left early.' },
    ]);
    expect(ticked).toEqual(['of of → of']);
    expect(unticked).toEqual(['teh → the', 'a → an', 'we → We']);
    expect(session.outputText(0)).toBe('I think teh cat of mine ate a apple. It rained today. we left early.');
  });

  it.each([
    // Right swaps the vetted table confirms: still offered, unticked (owner decision 2026-10-26).
    ['He is an useful man.', 'an → a'],
    ['Wait a hour please.', 'a → an'],
    ['He is a honest man.', 'a → an'],
    ['It was an one-time deal.', 'an → a'],
    ['He joined an union.', 'an → a'],
    ['She found an unique stone.', 'an → a'],
    ['A apple fell.', 'A → An'],
    ['a apple', 'a → an'],
    ['A apple', 'A → An'],
    ['We had chai with a apple at the dhaba.', 'a → an'],
    // "an" or "a" typed for "and" (F7 re-review 6, I-1), a letter label (M-1), Spanish "a" (M-2).
    ['My mother an father came to the school.', 'an → a'],
    ['Bring a pen an paper to the exam.', 'an → a'],
    ['Fill the form an hand it over.', 'an → a'],
    ['I like apple a orange.', 'a → an'],
    ['Grades: A excellent, B good, C average.', 'A → An'],
    ['Vamos a animal planet mañana.', 'a → an'],
  ])('starts no article swap ticked, but offers it on the card: "%s" (Task F8)', async (text, swap) => {
    const { session, ticked, unticked } = await applyAllWithDefaultTicks([{ id: 0, text }]);
    expect(ticked).toEqual([]);
    expect(unticked).toContain(swap);
    expect(session.outputText(0)).toBe(text);
  });

  it.each([
    // The table says the other article, or doesn't list the word (F5 re-review 4, I-1).
    'Police found an unidentified man near the gate.',
    'He has an urticaria rash.',
    'The new rules are an onerous burden.',
    'She filled a ewer with water.',
    'It was an historic day.',
    'He ate a APPLE.',
    'He ate a *apple* today.',
    // Outside the closed set: capitals, "i" → "I", punctuation spacing and dot runs (I-2 to I-4, M-4, M-5).
    'See page four, contd. from the last issue.',
    'Hmm . . . yes, we can.',
    'I use Yahoo! mail every day.',
    'a) the first point. b) the second point.',
    'Options: (i) first, (ii) second.',
    'Let i be an index and x = i + 1.',
    'It is fine.. done now.',
    'Call foo(a ,b) and x = y ,z today.',
  ])('ticks nothing outside the closed set: "%s"', async (text) => {
    expect(await outputOf(text)).toBe(text);
  });

  it.each([
    // A letter label or an initial (F6 re-review 5, I-1).
    'We leased a Class A office in Pune last year.',
    'He was treated for a Hepatitis A infection last spring.',
    'Approved by Priya A officer in charge.',
    'How To Become A Engineer In India',
    // Spanish or Portuguese "a" (F6 re-review 5, M-2).
    'Fui a animal planet y luego a idea nueva.',
    'Le dije que a idea era mala.',
    'Tenemos a idea muy buena para mañana.',
    'Ela comprou a apple para o almoço.',
    // Right swaps at a sentence start, after a colon or after a full stop.
    'A apple fell. A elephant came.',
    'Note: A apple is red. We left. An useful tip followed.',
  ])('ticks no article swap: "%s" (Task F8)', async (text) => {
    expect(await outputOf(text)).toBe(text);
  });

  it('ticks no article swap on a Markdown list line, and still ticks a doubled word there (Task F8)', async () => {
    const { paras } = await markdownAdapter.read(new TextEncoder().encode('- A apple fell.\n- Bring a pen an paper to the the exam.\n'));
    const { session, ticked } = await applyAllWithDefaultTicks(paras, { language: 'markdown' });
    expect(ticked).toEqual(['the the → the']);
    expect(paras.map((p) => session.outputText(p.id))).toEqual(['- A apple fell.\n- Bring a pen an paper to the exam.']);
  });

  it.each([
    'Meet at 5 pm. tomorrow please.',
    'Jan. was cold.',
    'Bros. came home.',
    'Hon. minister came.',
    'Wt. and ht. noted.',
    'Qty. ten is fine.',
    'Amt. due is ten.',
    'Ave. road is long.',
    'It rained today. Engg. college is near.',
    'It rained today. Ph.D. students came.',
    'The proof went to the HoD. Ph.D. scholars wait.',
    'She has a Ph.D. in physics.',
  ])('leaves no capital ticked after an abbreviation\'s dot, and no part of a word: "%s" (I-2)', async (text) => {
    expect(await outputOf(text)).toBe(text);
  });

  it.each([
    'It is a ewe lamb.',
    'Buy an lpg cylinder.',
    'He is an rss member.',
    'He got an sms today.',
    'See an hr manager.',
    'He is an mla now.',
    'He is an nri now.',
    'File an fir today.',
  ])('ticks no article before a short word, an initialism or a word another fix changes: "%s" (I-3)', async (text) => {
    expect(await outputOf(text)).toBe(text);
  });

  it('lists the two halves of "an sms" unticked: together they make "a SMS"', async () => {
    const { unticked } = await applyAllWithDefaultTicks([{ id: 0, text: 'He got an sms today.' }]);
    expect(unticked).toEqual(['an → a', 'sms → SMS']);
  });

  it('ticks no spaces the zero-click rule left as layout (M-4)', async () => {
    const { session, unticked } = await applyAllWithDefaultTicks([{ id: 0, text: 'Use tabs\t\there please.' }]);
    expect(unticked).toEqual(['\t\t →  ']);
    expect(session.outputText(0)).toBe('Use tabs\t\there please.');
  });
});
