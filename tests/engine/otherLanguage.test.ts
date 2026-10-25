import { describe, it, expect, beforeAll } from 'vitest';
import type { Candidate, Tier } from '@/engine/types';
import { buildDecisions } from '@/engine/decisions';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { isRomanisedIndic, loadRomanisedModel } from '@/engine/romanised/classifier';
import { findForeignSentences } from '@/engine/otherLanguage';

beforeAll(() => loadRomanisedModel());

/** Spelling flags of every whole-word `word` in `text` (paragraph 0), as Harper would report them. */
function flagsOf(text: string, word: string, replacements = ['chalk', 'halo']): Candidate[] {
  return [...text.matchAll(new RegExp(`\\b${word}\\b`, 'g'))].map((m) => ({
    id: `0:${m.index}:${word}`,
    paraId: 0,
    span: { start: m.index!, end: m.index! + word.length },
    original: word,
    replacements,
    kind: 'Spelling',
    message: 'msg',
    source: 'rules',
  }));
}
const review = (cs: Candidate[]) => new Map(cs.map((c) => [c.id, 'review' as Tier]));
const decide = (text: string, cs: Candidate[], typoWords?: Set<string>) =>
  buildDecisions(cs, review(cs), { paraText: new Map([[0, text]]), typoWords }).decisions;

describe('isRomanisedIndic (spec §5 words in other languages)', () => {
  it.each(['accha', 'chalo', 'khub', 'bhalo', 'nahi', 'kya', 'jaldi', 'paisa'])('"%s" is a romanised Indian-language word', (word) => {
    expect(isRomanisedIndic(word)).toBe(true);
  });

  it.each(['teh', 'recieve', 'becuase', 'goverment', 'wierd', 'definately', 'thier', 'occured'])('the typo "%s" is not', (word) => {
    expect(isRomanisedIndic(word)).toBe(false);
  });

  it('a slip of one of the commonest English words always wins: "yaar" (year), "hai" (had), "arre" (are)', () => {
    for (const word of ['yaar', 'hai', 'arre']) expect(isRomanisedIndic(word)).toBe(false);
  });

  it('judges only lowercase a-z words: never Devanagari or Bengali script, capitals or apostrophes', () => {
    for (const word of ['अच्छा', 'খুব', 'Accha', "accha's", 'k', 'acc4a']) expect(isRomanisedIndic(word)).toBe(false);
  });

  it('English two-letter slips are never romanised, so they stay off the card', () => {
    const slips = ['ot', 'fo', 'si', 'ti', 'th', 'nd', 'ur', 'im', 'ok', 'po', 'da', 'ma', 'pa'];
    expect(slips.filter((w) => isRomanisedIndic(w))).toEqual([]);
  });

  it('random letters are no language: unlikely under every model, so not Indian either', () => {
    expect(['wrdx', 'wrdqqqqqx', 'wrdqqqqqqqqqqqqqx', 'zzzz', 'qwrt'].filter((w) => isRomanisedIndic(w))).toEqual([]);
  });

  it('common English short words are never Indian-language words, in any of the ten languages', () => {
    // Harper flags po, da, ra and ok; two letters are too few to tell the languages apart.
    const short = ['po', 'da', 'ra', 'ma', 'pa', 'ok', 'so', 'to', 'si', 'ti'];
    expect(short.filter((w) => isRomanisedIndic(w))).toEqual([]);
  });

  it('a two-letter word common in English counts only inside a sentence mostly in another language', () => {
    // "ki" (Hindi "of") and "ra" are equally common in English text (Zipf 3.9): only the sentence tells them apart.
    expect([isRomanisedIndic('ki'), isRomanisedIndic('ki', true)]).toEqual([false, true]);
    expect(isRomanisedIndic('ke')).toBe(true); // Zipf 3.5: rare enough in English on its own
  });
});

describe('isRomanisedIndic across the ten languages', () => {
  it.each([
    ['Hindi/Urdu', 'kaise mujhe kyunki shukriya lekin aapka zaroor'],
    ['Bengali', 'kal bazare giyechilam khub bhalo laglo ebong kichu'],
    ['Tamil', 'naan kadaikku nalla irunthuchu aana konjam vilai adhigam'],
    ['Telugu', 'nenu vellanu chala bagundi kani konchem ekkuva dhara'],
    ['Kannada', 'angadige hogidde tumba chennagittu aadre swalpa jaasti bele'],
    ['Malayalam', 'njan kadayil poyi valare nannayirunnu pakshe kurachu vila kooduthal'],
    ['Marathi', 'mala khup aavadla tumhi kasa aahat udya kahi aahe nahi majha ghar aamhi'],
    ['Gujarati', 'kem naam majama chhu nathi'],
    ['Punjabi', 'tusi kiddan assi aavange bahut laggeya nahi sanu kitthe karde haan'],
  ])('%s words are romanised Indian-language words: %s', (_language, text) => {
    expect(text.split(' ').filter((w) => !isRomanisedIndic(w))).toEqual([]);
  });
});

describe('words-in-other-languages card (spec §5)', () => {
  const text = 'He said chalo, and the food was khub bhalo. I got teh letter.';

  it('flagged Indian-language words go on one card; an English typo stays its own decision', () => {
    const t = 'It was khub bhalo laglo, ebong kichu cheap. I got teh letter.';
    const bengali = ['khub', 'bhalo', 'laglo', 'ebong', 'kichu'];
    const words = bengali.flatMap((w) => flagsOf(t, w));
    const typo = flagsOf(t, 'teh', ['the']);
    const d = decide(t, [...words, ...typo]);
    expect(d.map((x) => x.kind)).toEqual(['single', 'otherLanguage']);
    expect(d[1]).toEqual({
      id: 'other-language',
      kind: 'otherLanguage',
      candidateIds: words.map((c) => c.id),
      label: '5 words in Indian languages',
      score: 0,
      // The rule is deliberately cautious: Bengali "khub" is one letter from "hub", so it starts unticked too.
      likelyTypos: [['khub', 'hub']],
    });
  });

  it('words of several languages share the one card', () => {
    const t = 'It was konjam nalla irunthuchu, khub bhalo laglo, and tusi kiddan assi said so.';
    const words = ['konjam', 'nalla', 'irunthuchu', 'khub', 'bhalo', 'laglo', 'tusi', 'kiddan', 'assi'];
    const cs = words.flatMap((w) => flagsOf(t, w));
    const card = decide(t, cs).find((d) => d.kind === 'otherLanguage')!;
    expect(card.candidateIds).toEqual(cs.map((c) => c.id));
  });

  it('a card word one edit from an everyday English word (Zipf ≥ 4) is marked as a likely typo of it', () => {
    const t = 'He said chalo, we will jion the byos, the poro and the babo, and dinr bhalo.';
    const slips = ['jion', 'byos', 'poro', 'babo', 'dinr'];
    const cs = [...flagsOf(t, 'chalo'), ...flagsOf(t, 'bhalo'), ...slips.flatMap((w) => flagsOf(t, w))];
    const card = decide(t, cs).find((d) => d.kind === 'otherLanguage')!;
    expect(card.likelyTypos).toEqual([
      ['jion', 'join'],
      ['poro', 'poor'],
      ['babo', 'baby'],
    ]);
    // With ten languages (S7b) the classifier itself turns "byos" and "dinr" down: they stay off the card as
    // ordinary flags. (Owner's decision, Zipf 4: "dinr" has no everyday neighbour, so on the card it would be
    // pre-ticked.) A change of either rule must show up here.
    const offCard = cs.filter((c) => c.original === 'byos' || c.original === 'dinr').map((c) => c.id);
    expect(card.candidateIds.filter((id) => offCard.includes(id))).toEqual([]);
  });

  it('one word: singular label; repeats of it count once', () => {
    const twice = 'Chalo then. We said chalo and chalo again.';
    const d = decide(twice, flagsOf(twice, 'chalo'));
    expect(d).toEqual([expect.objectContaining({ kind: 'otherLanguage', label: '1 word in an Indian language' })]);
  });

  it('a capitalised use joins the card when the word is also used in lowercase', () => {
    const t = 'Accha, we went. It was accha.';
    const cs = [...flagsOf(t, 'Accha', ['Accra']), ...flagsOf(t, 'accha', ['acacia'])];
    expect(decide(t, cs)).toEqual([expect.objectContaining({ kind: 'otherLanguage', candidateIds: cs.map((c) => c.id) })]);
  });

  it('a capitalised word alone stays on the names card (Indian names look Hindi too)', () => {
    const t = 'We met Venkatraman there.';
    expect(decide(t, flagsOf(t, 'Venkatraman', ['Venkatesh'])).map((x) => x.kind)).toEqual(['names']);
  });

  it('words the user kept as typos leave the card', () => {
    expect(decide(text, flagsOf(text, 'chalo'), new Set(['chalo'])).map((x) => x.kind)).toEqual(['single']);
  });

  it('a word used 3+ times is a term first: the terms card keeps it', () => {
    const t = 'The jaldi plan, a jaldi fix and the jaldi rule.';
    expect(decide(t, flagsOf(t, 'jaldi')).map((x) => x.kind)).toEqual(['terms']);
  });
});

describe('findForeignSentences: more than half of the words flagged', () => {
  const sentencesOf = (text: string, ...words: string[]) =>
    findForeignSentences(words.flatMap((w) => flagsOf(text, w)), new Map([[0, text]])).get(0) ?? [];

  it('exactly half flagged is not foreign: "teh end." stays fixable', () => {
    expect(sentencesOf('teh end.', 'teh')).toEqual([]);
  });

  it('a one-word sentence of a flagged word is foreign', () => {
    expect(sentencesOf('teh.', 'teh')).toEqual([{ start: 0, end: 4 }]);
  });

  it('only the sentence that is mostly flagged counts', () => {
    const text = 'I read it. ami kal te jabo.';
    expect(sentencesOf(text, 'ami', 'kal', 'te', 'jabo')).toEqual([{ start: 11, end: 27 }]);
  });

  it('a Hindi word counts as one word, not one per letter between its vowel signs', () => {
    // 5 words, 3 flagged: foreign. Split at the vowel signs and virama, हिन्दी and स्कूल would count as 6.
    expect(sentencesOf('ami हिन्दी स्कूल te jabo.', 'ami', 'te', 'jabo')).toEqual([{ start: 0, end: 25 }]);
  });
});

describe('words-in-other-languages card in a session (Harper)', () => {
  let linter: RulesLinter;
  beforeAll(async () => {
    linter = await createLinter('American');
  });
  const opts: CheckOptions = { preset: 'blog', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [] };
  const text = 'He said chalo, and the food was khub bhalo. I recieved the letter.';
  const words = ['bhalo', 'chalo', 'khub'];

  it('Harper flags the romanised words and the card takes them; the typo stays a decision', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts, { linter });
    const all = [...s.decisions().top, ...s.decisions().more];
    const card = all.find((d) => d.kind === 'otherLanguage')!;
    const byId = new Map(s.candidates().map((c) => [c.id, c.original]));
    expect(card.candidateIds.map((id) => byId.get(id)).sort()).toEqual(words);
    expect(all.some((d) => d.kind !== 'otherLanguage' && d.candidateIds.some((id) => byId.get(id) === 'recieved'))).toBe(true);
  });

  it('Tamil, Telugu and Punjabi words join the same card; English short words and loanwords stay off it', async () => {
    const mixed =
      'The food was konjam spicy but nalla, ma and pa said it was ok, so we took the bus to the po office near the ' +
      'railway station, college and cricket park. It was chala bagundi, tusi kiddan?';
    const s = await CheckSession.start([{ id: 0, text: mixed }], opts, { linter });
    const card = [...s.decisions().top, ...s.decisions().more].find((d) => d.kind === 'otherLanguage')!;
    const byId = new Map(s.candidates().map((c) => [c.id, c.original]));
    const onCard = card.candidateIds.map((id) => byId.get(id)!);
    expect(onCard).toEqual(expect.arrayContaining(['konjam', 'bagundi', 'tusi']));
    const english = ['ma', 'pa', 'ok', 'so', 'to', 'po', 'bus', 'railway', 'station', 'college', 'cricket', 'park'];
    expect(onCard.filter((w) => english.includes(w))).toEqual([]);
  });

  it('common English words (Zipf ≥ 3.9: mom, etc, mrs, aug) in English sentences stay off the card', async () => {
    const t =
      'I bought eggs, milk, bread etc and went home. My mom said we should leave early. We met mrs sharma at the ' +
      'gate. The deadline is 5 aug this year, and the food was khub bhalo laglo.';
    const s = await CheckSession.start([{ id: 0, text: t }], opts, { linter });
    const card = [...s.decisions().top, ...s.decisions().more].find((d) => d.kind === 'otherLanguage')!;
    const byId = new Map(s.candidates().map((c) => [c.id, c.original]));
    const onCard = card.candidateIds.map((id) => byId.get(id)!);
    expect(onCard).toEqual(expect.arrayContaining(['khub', 'bhalo']));
    expect(onCard.filter((w) => ['mom', 'etc', 'mrs', 'aug'].includes(w))).toEqual([]);
    expect(['mom', 'etc', 'mrs', 'aug', 'gps', 'uber', 'nhs', 'cia', 'abc'].filter((w) => isRomanisedIndic(w))).toEqual([]);
  });

  it('"ki" joins the card from a Hindi sentence; "ra" and "po" in an English sentence stay ordinary flags', async () => {
    const t = 'Mujhe ghar ki yaad aati, bahut zyada. We met Ra and the po box near the ra office.';
    const s = await CheckSession.start([{ id: 0, text: t }], opts, { linter });
    const card = [...s.decisions().top, ...s.decisions().more].find((d) => d.kind === 'otherLanguage')!;
    const byId = new Map(s.candidates().map((c) => [c.id, c.original]));
    const onCard = card.candidateIds.map((id) => byId.get(id)!);
    expect(onCard).toContain('ki');
    expect(onCard.filter((w) => w === 'ra' || w === 'po')).toEqual([]);
  });

  it('Devanagari and Bengali script are not spell-checked as English', async () => {
    const flags = await linter.lintParagraphs([{ id: 0, text: 'यह बहुत अच्छा है। এটা খুব ভালো।' }], 'plaintext');
    expect(flags.filter((c) => c.kind === 'Spelling' || c.kind === 'Typo')).toEqual([]);
  });

  it('acceptOtherLanguage adds the words to the dictionary; keepAsTypos splits a word out', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts); // own linter: words are added to it
    await s.acceptOtherLanguage(['KHUB']);
    expect(s.addedWords().sort()).toEqual(['bhalo', 'chalo']);
    const left = [...s.decisions().top, ...s.decisions().more];
    expect(left.some((d) => d.kind === 'otherLanguage')).toBe(false);
    expect(left.some((d) => d.label.startsWith('khub'))).toBe(true);
  });

  it('accept refuses the card (it is answered with acceptOtherLanguage)', async () => {
    const s = await CheckSession.start([{ id: 0, text }], opts, { linter });
    expect(() => s.accept('other-language', 0)).toThrow(/words in Indian languages card .*acceptOtherLanguage/);
  });

  it('"Add all" never adds a likely typo: it splits out unless the user ticked it explicitly', async () => {
    const slipText = 'He said chalo, and we will jion the khub bhalo party.';
    const first = await CheckSession.start([{ id: 0, text: slipText }], opts);
    const card = [...first.decisions().top, ...first.decisions().more].find((d) => d.kind === 'otherLanguage')!;
    expect(card.likelyTypos).toEqual([
      ['jion', 'join'],
      ['khub', 'hub'],
    ]);
    await first.acceptOtherLanguage([]);
    expect(first.addedWords().sort()).toEqual(['bhalo', 'chalo']);
    expect([...first.decisions().top, ...first.decisions().more].some((d) => d.label.startsWith('jion'))).toBe(true);

    const second = await CheckSession.start([{ id: 0, text: slipText }], opts);
    await second.acceptOtherLanguage([], ['KHUB']);
    expect(second.addedWords().sort()).toEqual(['bhalo', 'chalo', 'khub']);
  });
});

describe('romanised words are never auto-fixed (Harper)', () => {
  let linter: RulesLinter;
  beforeAll(async () => {
    linter = await createLinter('American');
  });
  const opts: CheckOptions = { preset: 'blog', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] };
  // A safe fix: applied without a click, or (Task F4) offered on the simple-fixes card.
  const autoFixedIn = (s: CheckSession) =>
    s
      .candidates()
      .filter((c) => s.tier(c.id) === 'safe' || s.tier(c.id) === 'batch')
      .map((c) => `${c.original} → ${c.replacements[0]}`);
  const autoFixed = async (text: string) => autoFixedIn(await CheckSession.start([{ id: 0, text }], opts, { linter }));

  it.each([
    ['te', 'ami kal school te jabo, tumi aschho?'], // Bengali "at", not "the"
    ['prakriti', 'Each person is born with a prakriti that shapes the doshas.'],
    ['dharshan', 'Hum mandir mein dharshan ke liye gaye the.'],
    ['bhittite', 'amader bhittite onek kaj hoyeche.'],
  ])('"%s" (romanised, or in a sentence mostly in another language) goes to review, not to a slip fix', async (word, text) => {
    const s = await CheckSession.start([{ id: 0, text }], opts, { linter });
    const flag = s.candidates().find((c) => c.original === word)!;
    expect(s.tier(flag.id)).toBe('review');
    expect(autoFixedIn(s)).toEqual([]);
  });

  it('a slip in an English sentence is still fixed, also next to Hindi words or with one inside it', async () => {
    expect(await autoFixed('I got teh letter and read it.')).toEqual(['teh → the']);
    expect(await autoFixed('He said chalo. I got teh letter and read it.')).toEqual(['teh → the']);
    expect(await autoFixed('We ate the batata vadas while my father explained, for teh twentieth year, the old road.')).toEqual([
      'teh → the',
    ]);
  });

  it('at the boundary: "teh end." (half flagged) is fixed, a lone lowercase "teh." goes to review', async () => {
    expect(await autoFixed('teh end.')).toEqual(['teh → the']);
    const s = await CheckSession.start([{ id: 0, text: 'teh.' }], opts, { linter });
    const flag = s.candidates().find((c) => c.original === 'teh')!;
    expect(s.tier(flag.id)).toBe('review');
  });

  it('a two-letter flag next to a romanised word in its sentence is not fixed: Punjabi "te" (and) stays', async () => {
    const t = 'We went to the dhaba te ate makki di roti with sarson da saag.';
    const s = await CheckSession.start([{ id: 0, text: t }], opts, { linter });
    expect(autoFixedIn(s).filter((fix) => fix.startsWith('te '))).toEqual([]);
    expect(s.tier(s.candidates().find((c) => c.original === 'te')!.id)).toBe('review');
  });
});
