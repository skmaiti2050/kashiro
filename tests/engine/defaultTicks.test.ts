/**
 * Task F5 (F4 re-review 3): "Review and apply all" on the simple-fixes card applies its ticked fixes with one click,
 * so a fix starts ticked only when it passes a gate on the shape of the change: whole words, the case kept, no two
 * fixes on neighbouring words, an article only before a plain dictionary word, a capital only where a sentence
 * surely starts, and no layout spaces. The rest are listed unticked.
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

describe('the simple-fixes card ticks a fix only when its shape is safe (Task F5)', () => {
  it('ticks the plain fixes: a slip, a doubled word, an article before a dictionary word, a real sentence start', async () => {
    expect(await outputOf('I think teh cat of of mine ate a apple. It rained today. we left early.')).toBe(
      'I think the cat of mine ate an apple. It rained today. We left early.',
    );
  });

  it('keeps the article\'s case: "A apple" becomes "An apple", not "AN apple" (I-1)', async () => {
    expect(await outputOf('A apple fell. A elephant came.')).toBe('An apple fell. An elephant came.');
    expect(await outputOf('It rained today. A elephant came.')).toBe('It rained today. An elephant came.');
    const { paras } = await markdownAdapter.read(new TextEncoder().encode('- A apple fell.\n- An banana.\n'));
    const { session } = await applyAllWithDefaultTicks(paras, { language: 'markdown' });
    expect(paras.map((p) => session.outputText(p.id))).toEqual(['- An apple fell.\n- A banana.']);
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
