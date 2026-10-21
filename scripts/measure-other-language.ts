/**
 * The acceptance gate of the words-in-other-languages card (spec §5), on the Dakshina sentences the model
 * was not built from (see scripts/build-romanised.ts for the source and its splits).
 *
 *   tune: word-level rates of the classifier alone on the tune split (used to choose its thresholds)
 *   test: the gate, through the real engine, one sentence per check:
 *     1. of the lowercase romanised words the English checker flags, the share on the card (≥ 70%);
 *     2. an English typo planted in each sentence: the share of flagged typos kept off the card (≥ 95%).
 *
 * Usage: npx tsx scripts/measure-other-language.ts <google-dakshina.csv> [tune|test]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { LANGUAGE_CODES, parseDataset, romanWords, splitOf, type DatasetRow } from './build-romanised';
import { createLinter, type RulesLinter } from '../src/engine/linter';
import { CheckSession, type CheckOptions } from '../src/engine/session';
import { isRomanisedIndic } from '../src/engine/romanised/classifier';
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

async function measureTune(rows: DatasetRow[], linter: RulesLinter): Promise<void> {
  const sentences = rows.filter((r) => splitOf(r.roman) === 'tune' && Object.values(LANGUAGE_CODES).includes(r.language));
  const indicWords = await flaggedWords(linter, [...new Set(sentences.flatMap((r) => romanWords(r.roman)))]);
  const nextTypo = typoMaker(7);
  const flaggedTypos = await flaggedWords(linter, [...new Set(Array.from({ length: 3000 }, nextTypo))]);
  console.log(`tune: Hindi/Bengali flagged words judged romanised ${percent(indicWords.filter(isRomanisedIndic).length, indicWords.length)}`);
  console.log(`tune: English typos judged romanised ${percent(flaggedTypos.filter(isRomanisedIndic).length, flaggedTypos.length)}`);
}

/** Places a typo between two words of `sentence`, chosen by `random`. */
function plantTypo(sentence: string, typo: string, random: () => number): { text: string; start: number } {
  const gaps = [...sentence.matchAll(/ /g)].map((m) => m.index!);
  const at = gaps.length ? gaps[Math.floor(random() * gaps.length)] : sentence.length;
  return { text: `${sentence.slice(0, at)} ${typo}${sentence.slice(at)}`, start: at + 1 };
}

async function measureTest(rows: DatasetRow[], linter: RulesLinter): Promise<void> {
  const nextTypo = typoMaker(20261021);
  const random = seededRandom(42);
  const totals = { flagged: 0, onCard: 0, capitalised: 0, typos: 0, typosOff: 0, typosAuto: 0, cardWords: 0, cardTypos: 0, sentences: 0 };
  const missed = new Map<string, number>();
  const typosOnCard: string[] = [];
  for (const code of Object.values(LANGUAGE_CODES)) {
    for (const { roman } of rows.filter((r) => r.language === code && splitOf(r.roman) === 'test')) {
      totals.sentences++;
      const clean = await CheckSession.start([{ id: 0, text: roman }], OPTIONS, { linter });
      const { top, more } = clean.decisions();
      const cardIds = new Set([...top, ...more].filter((d) => d.kind === 'otherLanguage').flatMap((d) => d.candidateIds));
      for (const c of clean.candidates().filter((c) => isWordFlag(c.kind))) {
        if (!/^[a-z]+$/.test(c.original)) {
          if (/^\p{Lu}/u.test(c.original)) totals.capitalised++;
          continue;
        }
        totals.flagged++;
        if (cardIds.has(c.id)) totals.onCard++;
        else missed.set(c.original, (missed.get(c.original) ?? 0) + 1);
      }

      const typo = nextTypo();
      const planted = plantTypo(roman, typo, random);
      const withTypo = await CheckSession.start([{ id: 0, text: planted.text }], OPTIONS, { linter });
      const decisions = [...withTypo.decisions().top, ...withTypo.decisions().more];
      const card = decisions.find((d) => d.kind === 'otherLanguage');
      const typoFlag = withTypo.candidates().find((c) => isWordFlag(c.kind) && c.span.start === planted.start && c.original === typo);
      if (card) totals.cardWords += card.candidateIds.length;
      if (!typoFlag) continue;
      totals.typos++;
      const singled = decisions.some((d) => (d.kind === 'single' || d.kind === 'batch') && d.candidateIds.includes(typoFlag.id));
      if (singled) totals.typosOff++;
      else if (withTypo.log().some((e) => e.candidateId === typoFlag.id && e.auto && e.status === 'applied')) totals.typosAuto++;
      if (card?.candidateIds.includes(typoFlag.id)) {
        totals.cardTypos++;
        typosOnCard.push(typo);
      }
    }
  }
  console.log(`test: ${totals.sentences} held-out sentences`);
  console.log(`gate 1: flagged lowercase romanised words on the card ${percent(totals.onCard, totals.flagged)}` +
    ` (capitalised flags, which go to the names card: ${totals.capitalised})`);
  console.log(`gate 2: flagged planted typos kept off the card ${percent(totals.typos - totals.cardTypos, totals.typos)}` +
    ` (own decision ${totals.typosOff}, auto-fixed as a slip ${totals.typosAuto}, on the card ${totals.cardTypos});` +
    ` card members that are planted typos ${percent(totals.cardTypos, totals.cardWords)}`);
  console.log(`typos on the card: ${typosOnCard.join(' ')}`);
  console.log(`most missed: ${[...missed].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([w, n]) => `${w}×${n}`).join(' ')}`);
}

async function main(): Promise<void> {
  const [inputPath, mode = 'test'] = process.argv.slice(2);
  if (!inputPath) throw new Error('Usage: npx tsx scripts/measure-other-language.ts <google-dakshina.csv> [tune|test]');
  const rows = parseDataset(readFileSync(inputPath, 'utf8'));
  const linter = await createLinter('Indian');
  const t0 = performance.now();
  if (mode === 'tune') await measureTune(rows, linter);
  else await measureTest(rows, linter);
  console.log(`(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
