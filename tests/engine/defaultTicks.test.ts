/**
 * "Review and apply all" on the simple-fixes card applies its ticked fixes with one click, so a fix starts ticked
 * only when it belongs to a closed, listed set: a doubled word on the allowlist, never next to another fix (Task
 * F6). Every a/an swap stays on the card unticked (Task F8, owner decision 2026-10-26): reviews #4 to #6 each found
 * a new way a ticked one was wrong. Everything else is listed unticked (Task F5's repros stay unticked).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
import { untickedByDefault, type TickContext } from '@/engine/defaultTicks';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { markdownAdapter, plaintextAdapter } from '@/formats/text';
import type { Candidate, Paragraph } from '@/engine/types';

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

  it('ticks no article swap on a Markdown list line, and no doubled word there either (Tasks F8, F21d)', async () => {
    // Task F21d (owner decision 2026-10-29): a list item is no clear prose sentence ("- make the the build"), so its
    // doubling is offered unticked.
    const { paras } = await markdownAdapter.read(new TextEncoder().encode('- A apple fell.\n- Bring a pen an paper to the the exam.\n'));
    const { session, ticked, unticked } = await applyAllWithDefaultTicks(paras, { language: 'markdown' });
    expect(ticked).toEqual([]);
    expect(unticked).toContain('the the → the');
    expect(paras.map((p) => session.outputText(p.id))).toEqual(['- A apple fell.\n- Bring a pen an paper to the the exam.']);
  });

  it('a paragraph that is mostly Hindi around the alphabet is set aside whole: nothing offered, text unchanged (#2a)', async () => {
    const { paras } = await plaintextAdapter.read(new TextEncoder().encode('अंग्रेज़ी वर्णमाला: A a, B b, C c.\n'));
    const { session, ticked, unticked } = await applyAllWithDefaultTicks(paras, { language: 'plaintext' });
    expect([...ticked, ...unticked]).toEqual([]);
    expect(paras.map((p) => session.outputText(p.id))).toEqual(paras.map((p) => p.text));
  });

  it.each([
    ['plain text', 'A a B b C c D d', 'plaintext'],
    ['after a colon', 'Letters: A a, B b, C c.', 'plaintext'],
    ['after a full stop', 'Copy the letters. A a, B b, C c.', 'plaintext'],
    ['a real slip at a sentence start too', 'We left. A a man came in.', 'plaintext'],
    ['after a short Hindi lead-in', 'वर्णमाला: A a, B b, C c, D d, E e, F f, G g.', 'plaintext'],
    ['on a Markdown list line', '- A a\n- B b\n- C c', 'markdown'],
    ['in a Markdown table cell', '| A a | B b |\n|---|---|\n| C c | D d |', 'markdown'],
  ] as const)('never starts the alphabet pair "A a" ticked, but lists it: %s (F8 re-review 7, M-1)', async (_where, text, language) => {
    const adapter = language === 'markdown' ? markdownAdapter : plaintextAdapter;
    const { paras } = await adapter.read(new TextEncoder().encode(text + '\n'));
    const { session, ticked, unticked } = await applyAllWithDefaultTicks(paras, { language });
    expect(ticked).toEqual([]);
    expect(unticked).toContain('A a → A');
    expect(paras.map((p) => session.outputText(p.id))).toEqual(paras.map((p) => p.text));
  });

  it.each([
    ['plain text', 'a a b b c c', 'plaintext'],
    ['after a colon', 'Say the sounds: a a, b b.', 'plaintext'],
    ['on a Markdown list line', '- a a\n- b b', 'markdown'],
    // Real slips, unticked too: the same trade-off as "A a man" (F9).
    ['a real slip', 'It was a a lot of work.', 'plaintext'],
    ['a real slip after letters', 'Letters: A, B and a a cat.', 'plaintext'],
  ] as const)('never starts a lowercase doubled "a" ticked, but lists it: %s (Task F10)', async (_where, text, language) => {
    const adapter = language === 'markdown' ? markdownAdapter : plaintextAdapter;
    const { paras } = await adapter.read(new TextEncoder().encode(text + '\n'));
    const { session, ticked, unticked } = await applyAllWithDefaultTicks(paras, { language });
    expect(ticked).toEqual([]);
    expect(unticked).toContain('a a → a');
    expect(paras.map((p) => session.outputText(p.id))).toEqual(paras.map((p) => p.text));
  });

  it.each([
    ['a capital first copy', 'An an. Bn bn.', 'An an → An', 'plaintext'],
    ['a lowercase pair after a colon', 'Sounds: an an, in in.', 'an an → an', 'plaintext'],
    ['on a Markdown list line', '- An an\n- Bn bn', 'An an → An', 'markdown'],
    // A real slip, unticked too: the same trade-off as "a a lot" (Task F10).
    ['a real slip', 'An an apple fell.', 'An an → An', 'plaintext'],
  ] as const)('never starts a doubled "an" ticked, but lists it: %s (Task F11)', async (_where, text, fix, language) => {
    const adapter = language === 'markdown' ? markdownAdapter : plaintextAdapter;
    const { paras } = await adapter.read(new TextEncoder().encode(text + '\n'));
    const { session, ticked, unticked } = await applyAllWithDefaultTicks(paras, { language });
    expect(ticked).toEqual([]);
    expect(unticked).toContain(fix);
    expect(paras.map((p) => session.outputText(p.id))).toEqual(paras.map((p) => p.text));
  });

  it.each([
    ['The the cat sat.', 'The the → The'],
    ['We left. The the cat sat.', 'The the → The'],
    ['Most of of them came.', 'of of → of'],
  ])('still ticks every other allowlisted doubling, a capital at a sentence start included: "%s"', async (text, fix) => {
    const { ticked } = await applyAllWithDefaultTicks([{ id: 0, text }]);
    expect(ticked).toEqual([fix]);
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

  it('starts every place of the review-tier "Repeated words" card unticked: they are often grammar (F8 re-review 7, M-4)', async () => {
    const text = 'He had had enough of it. He said that that was fine. What it is is a mess. The film was very very good.';
    const s = await CheckSession.start([{ id: 0, text }], opts(), { linter });
    const { top, more } = s.decisions();
    const card = [...top, ...more].find((d) => d.id === 'batch:repeated-words');
    expect(card?.label).toBe('Repeated words (4 places)');
    expect(card!.startUnticked).toEqual(card!.candidateIds);
  });

  it.each([
    ['He said THAT THAT was fine. I knew THAT THAT was wrong.', 'THAT THAT → THAT (2 places)'],
    ['HE HAD HAD ENOUGH. SHE HAD HAD LUNCH.', 'HAD HAD → HAD (2 places)'],
    ['He Had Had Enough. She Had Had Lunch.', 'Had Had → Had (2 places)'],
    ['He had  had enough. She had  had lunch.', 'had  had → had (2 places)'],
  ])('starts every place of any other batch card unticked, in any case or spacing: "%s" (Task F10)', async (text, label) => {
    const s = await CheckSession.start([{ id: 0, text }], opts(), { linter });
    const { top, more } = s.decisions();
    const batches = [...top, ...more].filter((d) => d.kind === 'batch');
    expect(batches.map((d) => d.label)).toEqual([label]);
    expect(batches[0].startUnticked).toEqual(batches[0].candidateIds);
  });

  it('ticks no spaces the zero-click rule left as layout (M-4)', async () => {
    const { session, unticked } = await applyAllWithDefaultTicks([{ id: 0, text: 'Use tabs\t\there please.' }]);
    expect(unticked).toEqual(['\t\t →  ']);
    expect(session.outputText(0)).toBe('Use tabs\t\there please.');
  });
});

describe('a doubled word right after a mention word is offered but never pre-ticked (#38)', () => {
  it.each([
    ['To open files, use the keyword with with the path.', 'with with → with'],
    ['Pass the Command the the file name.', 'the the → the'],
    ['Each of the options of of this tool is documented.', 'of of → of'],
    ['Set the FLAGS and and the paths before you start.', 'and and → and'],
  ])('starts unticked, leaves the text alone, and still lists it: "%s"', async (text, fix) => {
    const { session, ticked, unticked } = await applyAllWithDefaultTicks([{ id: 0, text }]);
    expect(ticked).toEqual([]);
    expect(unticked).toContain(fix);
    expect(session.outputText(0)).toBe(text);
  });

  it.each([
    ['We went to the the market.', 'the the → the'],
    ['Open files with with care.', 'with with → with'],
    ['The keyword list has a typo of of one letter.', 'of of → of'],
  ])('still starts a real slip ticked: "%s"', async (text, fix) => {
    const { ticked } = await applyAllWithDefaultTicks([{ id: 0, text }]);
    expect(ticked).toEqual([fix]);
  });
});

describe('legitimately doubled keywords are not repeated-word slips (#7)', () => {
  /** The doubled words on the simple-fixes card: locked text is never auto-applied, so a locked doubling must not be on it. */
  const doubledOffers = (s: CheckSession) => {
    const card = s.decisions().top.find((d) => d.id === SIMPLE_FIXES_ID);
    const onCard = new Set(card?.candidateIds ?? []);
    return s.candidates().filter((c) => onCard.has(c.id) && /^(\S+)\s+\1$/iu.test(c.original)).map((c) => c.original);
  };

  it.each([
    ['a reference-link label and its definition', 'See [the the] for details.\n\n[the the]: https://example.com\n', 'markdown'],
    ['a reference-link label with a second label', 'See [the the][ref] for details.\n\n[ref]: https://example.com\n', 'markdown'],
    ['an inline link label', 'See [the the](https://example.com) for details.\n', 'markdown'],
    ['a label defined later in the document', 'First read the intro.\n\nSee [of of] for details.\n\n[of of]: https://example.com\n', 'markdown'],
    ['a quoted keyword', 'Open files with "with with".\n', 'plaintext'],
    ['a backticked keyword', 'Open files with `with with`.\n', 'plaintext'],
  ] as const)('never offers or changes the doubling in %s', async (_what, text, language) => {
    const adapter = language === 'markdown' ? markdownAdapter : plaintextAdapter;
    const { paras } = await adapter.read(new TextEncoder().encode(text));
    const { session, ticked } = await applyAllWithDefaultTicks(paras, { language });
    expect(ticked).toEqual([]);
    expect(doubledOffers(session)).toEqual([]);
    expect(paras.map((p) => session.outputText(p.id))).toEqual(paras.map((p) => p.text));
  });

  it('still offers a real slip next to a reference-link label, ticked as usual', async () => {
    const { paras } = await markdownAdapter.read(new TextEncoder().encode('See [the the] and teh cat of of mine.\n\n[the the]: https://example.com\n'));
    const { session, ticked } = await applyAllWithDefaultTicks(paras, { language: 'markdown' });
    expect(ticked).toEqual(['of of → of']);
    expect(session.outputText(0)).toBe('See [the the] and teh cat of mine.');
  });

  it('locks a label whose spacing and case differ from its definition, in Markdown', async () => {
    const { paras } = await markdownAdapter.read(new TextEncoder().encode('See [The  The] for details.\n\n[the the]: https://example.com\n'));
    const { session, ticked } = await applyAllWithDefaultTicks(paras, { language: 'markdown' });
    expect(ticked).toEqual([]);
    expect(paras.map((p) => session.outputText(p.id))).toEqual(paras.map((p) => p.text));
  });

  it('leaves the typo in an ordinary link label an ordinary fix', async () => {
    const { paras } = await markdownAdapter.read(new TextEncoder().encode('See [teh docs](https://x.com) now.\n'));
    const { session, unticked } = await applyAllWithDefaultTicks(paras, { language: 'markdown' });
    expect(unticked).toEqual(['teh → the']);
    expect(session.candidates().map((c) => c.original)).toEqual(['teh']);
  });

  it('locks nothing for "[Name]: hello" in a plain-text document', async () => {
    const s = await CheckSession.start([{ id: 0, text: '[Name]: hello teh world' }], opts(), { linter });
    const c = s.candidates().find((x) => x.original === 'teh')!;
    expect(s.decisions().top.flatMap((d) => d.candidateIds)).toContain(c.id);
  });

  it('does not label-lock "[the the]" with a definition in a plain-text document', async () => {
    const paras = [{ id: 0, text: 'See [the the] for details.' }, { id: 1, text: '[the the]: https://example.com' }];
    const { ticked } = await applyAllWithDefaultTicks(paras);
    expect(ticked).toEqual(['the the → the']);
  });

  it('does not lock a long bracketed aside, so a typo inside it is still found', async () => {
    const s = await CheckSession.start([{ id: 0, text: 'He left [and then he went to the the shop on teh corner] quickly.' }], opts(), { linter });
    expect(doubledOffers(s)).toEqual(['the the']);
  });
});

describe("an engine's tick list (trust policy, #1)", () => {
  const text = 'We met the the team today.';
  const at = text.indexOf('the the');
  const slip: Candidate = { id: `0:${at}:${at + 7}:Repetition`, paraId: 0, span: { start: at, end: at + 7 }, original: 'the the', replacements: ['the'], kind: 'Repetition', message: 'Doubled word', source: 'rules' };
  const tickContext = (ticks: TickContext['ticks']): TickContext => ({
    paraText: new Map([[0, text]]),
    optedIn: () => false,
    commandText: () => [],
    unknownWords: () => [],
    ticks,
  });

  it("ticks a slip doubling where the engine's list is the slip doublings", () => {
    expect(untickedByDefault([slip], tickContext(() => 'slipDoublings'))).toEqual([]);
  });

  it("ticks nothing where the engine's list is none", () => {
    expect(untickedByDefault([slip], tickContext(() => 'none'))).toEqual([slip.id]);
  });
});
