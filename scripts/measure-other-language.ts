/**
 * The acceptance gate of the words-in-Indian-languages card (spec §5), per language, on the Dakshina sentences
 * the model was not built from (see scripts/build-romanised.ts for the source and its splits).
 *
 *   tune: word-level rates of the classifier alone on the tune split (used to choose its thresholds)
 *   test: the gate, through the real engine, one sentence per check:
 *     1. of the lowercase romanised words the English checker flags, the share on the card (≥ 70%);
 *     2. an English typo planted in each sentence: the share of flagged typos kept off the card (≥ 95%);
 *     3. short typos (one edit of a word of 2-3 or 3-5 letters) planted in each sentence: the share on the
 *        card, and on the card pre-ticked (not marked as a likely typo), which "Add all" would add.
 *   It ends with a table, one row per language. Name languages (comma-separated) to measure only those, for
 *   example to run several in parallel; each language's typos are seeded the same either way.
 *
 * Usage: npx tsx scripts/measure-other-language.ts <google-dakshina.csv> [tune|test] [hindi,tamil,…]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { LANGUAGE_CODES, parseDataset, romanWords, splitOf, type DatasetRow } from './build-romanised';
import { createLinter, type RulesLinter } from '../src/engine/linter';
import { CheckSession, type CheckOptions } from '../src/engine/session';
import type { Decision } from '../src/engine/decisions';
import { isRomanisedIndic, loadRomanisedModel } from '../src/engine/romanised/classifier';
import { INDIAN_LANGUAGES, type IndianLanguage } from '../src/engine/romanised/modelData';
import { wordsByFrequency, zipfOf } from '../src/engine/suggestions/frequency';

/** Classic misspellings (as in tests/engine/suggestionRanking.test.ts), planted alongside synthetic slips. */
const CLASSIC_TYPOS = (
  'acheive accross agressive apparantly arguement basicly begining beleive bizzare buisness calender catagory ' +
  'cemetary collegue comming commited completly concious curiousity definately dissapoint embarass enviroment ' +
  'existance familar finaly foriegn freind goverment gaurd happend harrass immediatly independant knowlege liason ' +
  'libary maintainance neccessary noticable ocassion persistant posession prefered publically realy reccomend ' +
  'refered relevent religous rember sucess suprise tommorow tounge truely wierd adn thier wich peice writting teh ' +
  'recieve occured seperate untill wont alot becuase'
).split(' ');

const OPTIONS: CheckOptions = { preset: 'blog', fallbackVariant: 'Indian', variant: 'Indian', language: 'plaintext', dictionary: [] };
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** A small seeded generator, so every run plants the same typos. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 2 ** 32;
  };
}

/** One random edit: delete, insert, substitute or swap two neighbouring letters. */
function slip(word: string, random: () => number): string {
  const i = Math.floor(random() * word.length);
  const letter = LETTERS[Math.floor(random() * 26)];
  switch (Math.floor(random() * 4)) {
    case 0:
      return word.slice(0, i) + word.slice(i + 1);
    case 1:
      return word.slice(0, i) + letter + word.slice(i);
    case 2:
      return word.slice(0, i) + letter + word.slice(i + 1);
    default:
      return i < word.length - 1 ? word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2) : word + letter;
  }
}

/**
 * English typos as a writer makes them: a frequency-weighted English word (4+ letters, Zipf ≥ 3) with one
 * random edit (two for 8+ letters, a third of the time), and one in four a classic misspelling.
 */
export function typoMaker(seed: number): () => string {
  const random = seededRandom(seed);
  const pool = wordsByFrequency().filter((w) => /^[a-z]{4,}$/.test(w) && zipfOf(w) >= 3);
  const cumulative: number[] = [];
  let total = 0;
  for (const w of pool) cumulative.push((total += 10 ** zipfOf(w)));
  const pick = () => {
    const x = random() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return pool[lo];
  };
  return () => {
    if (random() < 0.25) return CLASSIC_TYPOS[Math.floor(random() * CLASSIC_TYPOS.length)];
    const word = pick();
    const once = slip(word, random);
    return word.length >= 8 && random() < 0.3 ? slip(once, random) : once;
  };
}

/** Words of `minLength`-`maxLength` letters with Zipf ≥ 3.5, each as likely as the next, with one random edit. */
function shortTypoMaker(seed: number, minLength: number, maxLength: number): () => string {
  const random = seededRandom(seed);
  const pool = wordsByFrequency().filter((w) => /^[a-z]+$/.test(w) && w.length >= minLength && w.length <= maxLength && zipfOf(w) >= 3.5);
  return () => slip(pool[Math.floor(random() * pool.length)], random);
}

const percent = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1)}% (${part}/${whole})`;
const isWordFlag = (kind: string) => kind === 'Spelling' || kind === 'Typo';

/** The words among `words` that the checker flags, linted 300 at a time. */
export async function flaggedWords(linter: RulesLinter, words: string[]): Promise<string[]> {
  const flagged = new Set<string>();
  for (let i = 0; i < words.length; i += 300) {
    const text = words.slice(i, i + 300).join(' and ') + '.';
    for (const c of await linter.lintSpelling([{ id: 0, text }], 'Indian')) if (isWordFlag(c.kind)) flagged.add(c.original);
  }
  return words.filter((w) => flagged.has(w));
}

async function measureTune(rows: DatasetRow[], linter: RulesLinter, languages: IndianLanguage[]): Promise<void> {
  await loadRomanisedModel();
  for (const language of languages) {
    const sentences = rows.filter((r) => splitOf(r.roman) === 'tune' && r.language === LANGUAGE_CODES[language]);
    const words = await flaggedWords(linter, [...new Set(sentences.flatMap((r) => romanWords(r.roman)))]);
    const judged = words.filter((w) => isRomanisedIndic(w));
    console.log(`tune: ${language} flagged words judged romanised ${percent(judged.length, words.length)}`);
  }
  const nextTypo = typoMaker(7);
  const flaggedTypos = await flaggedWords(linter, [...new Set(Array.from({ length: 3000 }, nextTypo))]);
  console.log(`tune: English typos judged romanised ${percent(flaggedTypos.filter((w) => isRomanisedIndic(w)).length, flaggedTypos.length)}`);
}

/** Places a typo between two words of `sentence`, chosen by `random`. */
function plantTypo(sentence: string, typo: string, random: () => number): { text: string; start: number } {
  const gaps = [...sentence.matchAll(/ /g)].map((m) => m.index!);
  const at = gaps.length ? gaps[Math.floor(random() * gaps.length)] : sentence.length;
  return { text: `${sentence.slice(0, at)} ${typo}${sentence.slice(at)}`, start: at + 1 };
}

/** The words-in-other-languages card of a check, if any, and whether `word` is pre-ticked on it. */
function otherLanguageCard(session: CheckSession): { card?: Decision; preTicked: (word: string) => boolean } {
  const card = [...session.decisions().top, ...session.decisions().more].find((d) => d.kind === 'otherLanguage');
  const unticked = new Set((card?.likelyTypos ?? []).map(([word]) => word));
  return { card, preTicked: (word) => !unticked.has(word.toLowerCase()) };
}

interface ShortTypoTotals {
  flagged: number;
  onCard: number;
  preTicked: number;
  examples: string[];
}

/** Plants `typo` in `sentence` and records whether its flag lands on the card, and pre-ticked. */
async function checkShortTypo(sentence: string, typo: string, random: () => number, linter: RulesLinter, totals: ShortTypoTotals) {
  const planted = plantTypo(sentence, typo, random);
  const session = await CheckSession.start([{ id: 0, text: planted.text }], OPTIONS, { linter });
  const flag = session
    .candidates()
    .find((c) => isWordFlag(c.kind) && c.span.start === planted.start && c.original === typo && session.tier(c.id) !== 'hidden');
  if (!flag) return;
  totals.flagged++;
  const { card, preTicked } = otherLanguageCard(session);
  if (!card?.candidateIds.includes(flag.id)) return;
  totals.onCard++;
  if (!preTicked(typo)) return;
  totals.preTicked++;
  totals.examples.push(typo);
}

/** The gate on one language's held-out test sentences; prints its lines and returns its table row. */
async function measureLanguage(language: IndianLanguage, rows: DatasetRow[], linter: RulesLinter): Promise<string> {
  // Seeds per language, so languages measured apart (in parallel runs) plant the same typos. Hindi keeps S7's.
  const offset = INDIAN_LANGUAGES.indexOf(language) * 1000;
  const nextTypo = typoMaker(20261021 + offset);
  const random = seededRandom(42 + offset);
  // Its own generator, so gate 2 plants exactly as before the short typos were added.
  const shortRandom = seededRandom(43 + offset);
  const shortPools = [
    { name: '2-3 letters', next: shortTypoMaker(23 + offset, 2, 3) },
    { name: '3-5 letters', next: shortTypoMaker(35 + offset, 3, 5) },
  ].map((pool) => ({ ...pool, totals: { flagged: 0, onCard: 0, preTicked: 0, examples: [] } as ShortTypoTotals }));
  const totals = {
    flagged: 0,
    onCard: 0,
    onCardPreTicked: 0,
    autoFixed: 0,
    capitalised: 0,
    typos: 0,
    typosOff: 0,
    typosAuto: 0,
    cardWords: 0,
    cardTypos: 0,
    cardTyposPreTicked: 0,
    sentences: 0,
  };
  const missed = new Map<string, number>();
  const typosOnCard: string[] = [];
  const autoFixed: string[] = [];
  const code = LANGUAGE_CODES[language];
  for (const { roman } of rows.filter((r) => r.language === code && splitOf(r.roman) === 'test')) {
    totals.sentences++;
    const clean = await CheckSession.start([{ id: 0, text: roman }], OPTIONS, { linter });
    const { card: cleanCard, preTicked } = otherLanguageCard(clean);
    const cardIds = new Set(cleanCard?.candidateIds ?? []);
    const autoIds = new Set(clean.log().filter((e) => e.auto && e.status === 'applied').map((e) => e.candidateId));
    for (const c of clean.candidates().filter((c) => isWordFlag(c.kind))) {
      if (!/^[a-z]+$/.test(c.original)) {
        if (/^\p{Lu}/u.test(c.original)) totals.capitalised++;
        continue;
      }
      totals.flagged++;
      if (autoIds.has(c.id)) {
        totals.autoFixed++;
        autoFixed.push(c.original);
      }
      if (cardIds.has(c.id)) {
        totals.onCard++;
        if (preTicked(c.original)) totals.onCardPreTicked++;
      } else missed.set(c.original, (missed.get(c.original) ?? 0) + 1);
    }
    for (const pool of shortPools) await checkShortTypo(roman, pool.next(), shortRandom, linter, pool.totals);

    const typo = nextTypo();
    const planted = plantTypo(roman, typo, random);
    const withTypo = await CheckSession.start([{ id: 0, text: planted.text }], OPTIONS, { linter });
    const decisions = [...withTypo.decisions().top, ...withTypo.decisions().more];
    const { card, preTicked: typoPreTicked } = otherLanguageCard(withTypo);
    const typoFlag = withTypo.candidates().find((c) => isWordFlag(c.kind) && c.span.start === planted.start && c.original === typo);
    if (card) totals.cardWords += card.candidateIds.length;
    if (!typoFlag) continue;
    totals.typos++;
    const singled = decisions.some((d) => (d.kind === 'single' || d.kind === 'batch') && d.candidateIds.includes(typoFlag.id));
    if (singled) totals.typosOff++;
    else if (withTypo.log().some((e) => e.candidateId === typoFlag.id && e.auto && e.status === 'applied')) totals.typosAuto++;
    if (card?.candidateIds.includes(typoFlag.id)) {
      totals.cardTypos++;
      if (typoPreTicked(typo)) totals.cardTyposPreTicked++;
      typosOnCard.push(typo);
    }
  }
  const say = (line: string) => console.log(`[${language}] ${line}`);
  say(`${totals.sentences} held-out sentences`);
  say(`gate 1: flagged lowercase romanised words on the card ${percent(totals.onCard, totals.flagged)}` +
    ` (pre-ticked ${percent(totals.onCardPreTicked, totals.onCard)} of them;` +
    ` capitalised flags, which go to the names card: ${totals.capitalised})`);
  say(`flagged lowercase words auto-fixed as a slip: ${totals.autoFixed} (${[...new Set(autoFixed)].slice(0, 30).join(' ')})`);
  say(`gate 2: flagged planted typos kept off the card ${percent(totals.typos - totals.cardTypos, totals.typos)}` +
    ` (own decision ${totals.typosOff}, auto-fixed as a slip ${totals.typosAuto}, on the card ${totals.cardTypos},` +
    ` of them pre-ticked ${totals.cardTyposPreTicked}); card members that are planted typos ${percent(totals.cardTypos, totals.cardWords)}`);
  say(`typos on the card: ${typosOnCard.join(' ')}`);
  for (const { name, totals: t } of shortPools) {
    say(`short typos (${name}): flagged ${t.flagged}; on the card ${percent(t.onCard, t.flagged)};` +
      ` on the card AND pre-ticked ${percent(t.preTicked, t.flagged)} (${t.examples.slice(0, 20).join(' ')})`);
  }
  say(`most missed:${[...missed].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([w, n]) => `${w}×${n}`).join(' ')}`);

  const coverage = totals.onCard / totals.flagged;
  const precision = (totals.typos - totals.cardTypos) / totals.typos;
  const pass = coverage >= 0.7 && precision >= 0.95 ? 'yes' : '**no**';
  const [short2, short3] = shortPools.map(({ totals: t }) => `${percent(t.onCard, t.flagged)} / ${percent(t.preTicked, t.flagged)}`);
  return `| ${language} | ${percent(totals.onCard, totals.flagged)} | ${percent(totals.typos - totals.cardTypos, totals.typos)} | ${short2} | ${short3} | ${pass} |`;
}

async function measureTest(rows: DatasetRow[], linter: RulesLinter, languages: IndianLanguage[]): Promise<void> {
  const table = ['| Language | Gate 1: on the card (≥ 70%) | Gate 2: typos kept off (≥ 95%) | Short 2-3: on card / AND pre-ticked | Short 3-5: on card / AND pre-ticked | Pass |'];
  table.push('|---|---|---|---|---|---|');
  for (const language of languages) table.push(await measureLanguage(language, rows, linter));
  console.log(table.join('\n'));
}

async function main(): Promise<void> {
  const [inputPath, mode = 'test', only] = process.argv.slice(2);
  if (!inputPath) throw new Error('Usage: npx tsx scripts/measure-other-language.ts <google-dakshina.csv> [tune|test] [hindi,tamil,…]');
  const languages = only ? (only.split(',') as IndianLanguage[]) : [...INDIAN_LANGUAGES];
  const unknown = languages.filter((l) => !INDIAN_LANGUAGES.includes(l));
  if (unknown.length) throw new Error(`Unknown language ${unknown.join(', ')}: use ${INDIAN_LANGUAGES.join(', ')}`);
  const rows = parseDataset(readFileSync(inputPath, 'utf8'));
  const linter = await createLinter('Indian');
  const t0 = performance.now();
  if (mode === 'tune') await measureTune(rows, linter, languages);
  else await measureTest(rows, linter, languages);
  console.log(`(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
