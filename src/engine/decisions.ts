import type { Candidate, Span, Tier } from './types';
import { followsAbbreviation, overlapsLocked } from './factLock';
import { doubledWord, isLikelyTypo, isNameFlag, TITLE_CASE_WORD, WORD_REWRITE_KINDS, withinOneEdit } from './wordFlags';
import { DEFAULT_TERM_MIN_REPEATS, findTerms } from './terms';
import { everydayWordNear, findOtherLanguageWords } from './otherLanguage';
import { DEFAULT_MODULES, type ModuleSwitches } from './modules';

export interface Decision {
  /** `batch:<key>` for a batch, the candidate id for a single, `names` / `terms` / `other-language` for the cards. */
  id: string;
  kind: 'single' | 'batch' | 'names' | 'terms' | 'otherLanguage';
  candidateIds: string[];
  label: string;
  score: number;
  /**
   * Names card only: pairs of its words one edit apart, in order of appearance (["Pirya", "Priya"]).
   * One of each pair is probably a typo of the other, so the UI pre-unticks it.
   */
  nearDuplicates?: [string, string][];
  /** Terms card only: each term (lowercased) → its uses in the document ({ sarpanch: 5 }). */
  counts?: Record<string, number>;
  /**
   * Words-in-Indian-languages card only: its words one edit from an everyday English word, with that word, in
   * order of appearance ([["jion", "join"]]). Each may be a typo, so the UI pre-unticks it and
   * acceptOtherLanguage adds it only when ticked explicitly.
   */
  likelyTypos?: [string, string][];
  /**
   * Batches only: the members that start unticked in the preview, in card order. On the simple-fixes card,
   * defaultTicks picks them and "Review and apply all" applies the others with one click (Task F5); on every
   * other batch card every member starts unticked (owner decision 2026-10-27, Task F10).
   */
  startUnticked?: string[];
}

const WEIGHTS: Record<string, number> = {
  Grammar: 5,
  Agreement: 5,
  Malapropism: 5,
  Eggcorn: 5,
  WordChoice: 4,
  Usage: 4,
  WordOrder: 4,
  Rewrite: 4,
  Punctuation: 3,
  Variant: 3,
  Contraction: 2,
  Style: 1,
  Readability: 1,
  Enhancement: 1,
  Redundancy: 1,
};
/** Kinds not in the table (e.g. a lowercase Spelling with several suggestions). */
const DEFAULT_WEIGHT = 2;

/** Id of the names card decision (there is at most one). */
export const NAMES_CARD_ID = 'names';

/** The names card: every name flag in the document as one decision, counted once (spec §5). */
function namesCard(names: Candidate[]): Decision {
  const firstSpelling = new Map<string, string>(); // lowercased → first spelling seen
  for (const c of names) if (!firstSpelling.has(c.original.toLowerCase())) firstSpelling.set(c.original.toLowerCase(), c.original);
  const words = [...firstSpelling.values()];
  const label = words.length === 1 ? '1 name or place' : `${words.length} names and places`;
  // Initials ("A.", "R.") and acronyms ("CGST", "SGST") are often one edit apart without being typos.
  const comparable = words.filter((w) => TITLE_CASE_WORD.test(w) && w.length >= 4);
  const nearDuplicates: [string, string][] = [];
  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) {
      if (withinOneEdit(comparable[i], comparable[j])) nearDuplicates.push([comparable[i], comparable[j]]);
    }
  }
  return { id: NAMES_CARD_ID, kind: 'names', candidateIds: names.map((c) => c.id), label, score: 0, nearDuplicates };
}

/** Id of the terms card decision (there is at most one). */
export const TERMS_CARD_ID = 'terms';

/** The terms card: every flag of a term (see findTerms) as one decision, counted once (spec §5). */
function termsCard(flags: Candidate[], uses: Map<string, number>): Decision {
  const counts: Record<string, number> = {};
  for (const c of flags) counts[c.original.toLowerCase()] = uses.get(c.original.toLowerCase())!;
  const n = Object.keys(counts).length;
  const label = `${n} ${n === 1 ? 'term' : 'terms'} used in this document`;
  return { id: TERMS_CARD_ID, kind: 'terms', candidateIds: flags.map((c) => c.id), label, score: 0, counts };
}

/** Id of the words-in-other-languages card decision (there is at most one). */
export const OTHER_LANGUAGE_CARD_ID = 'other-language';

/** The words-in-Indian-languages card: every flag of a romanised Indian-language word as one decision (spec §5). */
function otherLanguageCard(flags: Candidate[]): Decision {
  const words = [...new Set(flags.map((c) => c.original.toLowerCase()))];
  const label = words.length === 1 ? '1 word in an Indian language' : `${words.length} words in Indian languages`;
  const likelyTypos: [string, string][] = [];
  for (const word of words) {
    const everyday = everydayWordNear(word);
    if (everyday) likelyTypos.push([word, everyday]);
  }
  return { id: OTHER_LANGUAGE_CARD_ID, kind: 'otherLanguage', candidateIds: flags.map((c) => c.id), label, score: 0, likelyTypos };
}

/**
 * Candidates on a fact-locked span (names mid-sentence, numbers, quotes, citations) fold under
 * "more" instead of competing for the top decisions (spec §10 budget): the app protects those
 * spans, so it should not lead with offers to change them. A sentence-initial capitalised
 * misspelling is not locked and stays ranked. A Capitalization flag right after an abbreviation
 * ("Mr. and") is the linter misreading the period as a sentence end, so it folds too.
 */
export function foldsUnderMore(c: Candidate, locked: Span[] | undefined, text?: string): boolean {
  if (c.kind === 'Capitalization' && text !== undefined && followsAbbreviation(text, c.span.start)) return true;
  return overlapsLocked(c, locked);
}

function scoreOf(c: Candidate, batch: boolean): number {
  if (isNameFlag(c)) return 0;
  return (WEIGHTS[c.kind] ?? DEFAULT_WEIGHT) + (batch ? 1 : 0);
}

function singleLabel(c: Candidate): string {
  if (c.replacements.length === 0) return `${c.original}: ${c.message}`;
  return `${c.original} → ${c.replacements.join(' / ')}`;
}

const REPEATED_WORDS_KEY = 'repeated-words';

/**
 * Id of the simple-fixes card: every fix of the 'batch' tier (the safe rules, and the kinds the user listed on it
 * in Settings) as one decision, "N simple fixes: review and apply all". Nothing that changes a word is applied
 * without a click (owner decision, Task F4); this card keeps those fixes to one click, for the ones it ticks
 * (Decision.startUnticked, Task F5).
 */
export const SIMPLE_FIXES_ID = 'batch:simple-fixes';

function simpleFixesCard(fixes: Candidate[], startUnticked: string[]): Decision {
  const n = fixes.length;
  const label = n === 1 ? '1 simple fix: review and apply' : `${n} simple fixes: review and apply all`;
  // Above every weight: buildDecisions puts the card first.
  return { id: SIMPLE_FIXES_ID, kind: 'batch', candidateIds: fixes.map((c) => c.id), label, score: 10, startUnticked };
}

/**
 * The batch key of a review candidate (spec §5: "the same correction repeated → one decision"):
 * - Spelling/Typo: kind + lowercased word, whatever the suggestions. One decision per flagged word
 *   ("Sujit (12 places)"), resolved by adding it to the dictionary, ignoring all, or one replacement for all.
 * - a doubled word (doubledWord): one key for all of them, "had had" and "that that" alike; the batch
 *   preview lists each place with its own fix, to tick the ones that are slips.
 * - exactly one replacement: kind + lower(original) + '→' + lower(replacement) (each member keeps its own
 *   replacement on accept, so "It's → Its" keeps its capital).
 * - otherwise (no fix, or a choice): kind + lower(original) + message, i.e. the identical flag repeated.
 */
function batchKey(c: Candidate): string {
  const o = c.original.toLowerCase();
  if (WORD_REWRITE_KINDS.has(c.kind)) return `word:${c.kind}:${o}`;
  // Every doubled word is the same correction, keep the first copy: one "Repeated words" decision to tick through.
  if (doubledWord(c) !== null) return REPEATED_WORDS_KEY;
  if (c.replacements.length === 1) return c.kind + o + '→' + c.replacements[0].toLowerCase();
  return `flag:${c.kind}:${o}:${c.message}`;
}

function batchLabel(c: Candidate, n: number): string {
  if (doubledWord(c) !== null) return `Repeated words (${n} places)`;
  if (WORD_REWRITE_KINDS.has(c.kind)) {
    const fixes = c.replacements.length ? ` → ${c.replacements.join(' / ')}` : '';
    return `${c.original}${fixes} (${n} places)`;
  }
  return `${singleLabel(c)} (${n} places)`;
}

interface DecisionOptions {
  /** Candidates on fact-locked spans: demoted (see buildDecisions). */
  fold?: (c: Candidate) => boolean;
  /** Lowercased words the user unticked on a card: real typos, ranked as words. */
  typoWords?: ReadonlySet<string>;
  /** paraId → paragraph text, to tell a sentence-initial typo from a name (isLikelyTypo). */
  paraText?: ReadonlyMap<number, string>;
  /** Candidates that cannot be applied (inside an existing tracked change): returned in `blocked`. */
  blocked?: (c: Candidate) => boolean;
  /** Uses a lowercase unknown word needs to count as a term (default 3); needs `paraText`. */
  termMinRepeats?: number;
  /** paraId → sentences mostly in another language (findForeignSentences), for findOtherLanguageWords. */
  foreignSentences?: ReadonlyMap<number, Span[]>;
  /** Which cards to build (default DEFAULT_MODULES): a card switched off leaves its flags as per-word decisions. */
  modules?: ModuleSwitches;
  /** The simple-fixes card's members that start unticked (defaultTicks); default none. */
  untickedOnCard?: (fixes: Candidate[]) => string[];
  /** Candidates on command text: their spelling flags are single decisions, never a batch (Task F21, review M-17). */
  onCommand?: (c: Candidate) => boolean;
  /** Paragraphs English checks (default all): only their flags can be words in Indian languages (romanised model). */
  englishParagraph?: (paraId: number) => boolean;
}

/** Decisions grouped by batch key, in first-appearance order. */
class DecisionGroups {
  private readonly groups = new Map<string, Candidate[]>();

  /** `alone`: the candidate is a decision of its own, whatever its batch key. */
  add(c: Candidate, alone = false): void {
    const key = alone ? `alone:${c.id}` : batchKey(c);
    const g = this.groups.get(key);
    if (g) g.push(c);
    else this.groups.set(key, [c]);
  }

  toDecisions(score: (c: Candidate, batch: boolean) => number): Decision[] {
    return [...this.groups].map(([key, g]): Decision => {
      const c = g[0];
      if (g.length > 1) {
        const candidateIds = g.map((x) => x.id);
        // Only the simple-fixes card ticks anything (owner decision 2026-10-27, Task F10): a fix that suits one place
        // can damage another ("THAT THAT" is grammar, "wagged it's tail" → "it is tail"), so the user ticks each place.
        return { id: `batch:${key}`, kind: 'batch', candidateIds, label: batchLabel(c, g.length), score: score(c, true), startUnticked: candidateIds };
      }
      return { id: c.id, kind: 'single', candidateIds: [c.id], label: singleLabel(c), score: score(c, false) };
    });
  }
}

/**
 * Safe candidates become auto-applied ids; 'batch'-tier candidates become the one simple-fixes card, ranked
 * first; review-tier candidates become decisions, batched by `batchKey` (members in input order). Hidden
 * candidates are dropped. Decisions are sorted by score desc, ties in input order.
 * Demoted (never dropped): candidates matching `fold` (fact-locked spans) and Spelling/Typo flags of a
 * word that `fold` matched elsewhere (a name everywhere). They batch among themselves, get score 0 and
 * rank after every other decision, so they only reach the top when there is room. `demoted` lists
 * their decision ids.
 * Names: every capitalised Spelling/Typo flag goes on one names card, ranked last (spec §5), except
 * likely typos (isLikelyTypo) and Spelling/Typo flags of words in `typoWords`: those rank like any word.
 * Terms: Spelling/Typo flags of a term (findTerms, needs `paraText`), its capitalised uses included, go
 * on one terms card, ranked just above the names card (spec §5).
 * Other languages: Spelling/Typo flags of a romanised Indian-language word (findOtherLanguageWords; a term
 * stays on the terms card), its capitalised uses included, go on one card between the terms and names cards.
 * Commands: a Spelling/Typo flag on command text (`onCommand`) is a single decision of its own, demoted, never in a
 * batch or on a card (Task F21, review M-17).
 * Blocked candidates go into `blocked` (scored and sorted the same way), except flags that join a card:
 * adding a word to the dictionary changes no text.
 */
export function buildDecisions(
  cands: Candidate[],
  tiers: Map<string, Tier>,
  {
    fold = () => false,
    typoWords = new Set(),
    paraText,
    blocked = () => false,
    termMinRepeats = DEFAULT_TERM_MIN_REPEATS,
    foreignSentences,
    modules = DEFAULT_MODULES,
    untickedOnCard = () => [],
    onCommand = () => false,
    englishParagraph = () => true,
  }: DecisionOptions = {},
): { safe: string[]; decisions: Decision[]; demoted: string[]; blocked: Decision[] } {
  const reviewFlags = cands.filter((c) => (tiers.get(c.id) ?? 'review') === 'review');
  const terms =
    paraText && modules.termsCard ? findTerms(reviewFlags, paraText, termMinRepeats, typoWords) : new Map<string, number>();
  // A term's capitalised uses ("Dosha" mid-sentence) join the terms card too: one word, one card.
  const isTermFlag = (c: Candidate) => WORD_REWRITE_KINDS.has(c.kind) && terms.has(c.original.toLowerCase());
  const otherLanguage = modules.otherLanguageCard
    ? findOtherLanguageWords(reviewFlags.filter((c) => englishParagraph(c.paraId)), typoWords, new Set(terms.keys()), foreignSentences)
    : new Set<string>();
  const isOtherLanguageFlag = (c: Candidate) => WORD_REWRITE_KINDS.has(c.kind) && otherLanguage.has(c.original.toLowerCase());
  const safe: string[] = [];
  const wordOf = (c: Candidate) => (WORD_REWRITE_KINDS.has(c.kind) ? c.kind + c.original.toLowerCase() : null);
  // A word the document uses as a fact-locked name somewhere is a name everywhere (e.g. sentence-initial).
  const lockedWords = new Set(cands.filter((c) => wordOf(c) !== null && fold(c)).map((c) => wordOf(c)!));
  const rankedAsWord = (c: Candidate) =>
    WORD_REWRITE_KINDS.has(c.kind) && (typoWords.has(c.original.toLowerCase()) || isLikelyTypo(c, paraText));

  const normal = new DecisionGroups();
  const demoted = new DecisionGroups();
  const blockedGroups = new DecisionGroups();
  const names: Candidate[] = [];
  const termFlags: Candidate[] = [];
  const otherLanguageFlags: Candidate[] = [];
  const simpleFixes: Candidate[] = [];
  for (const c of cands) {
    const t = tiers.get(c.id) ?? 'review';
    if (t === 'hidden') continue;
    if (t === 'safe') {
      safe.push(c.id);
      continue;
    }
    if (t === 'batch' && !blocked(c)) {
      simpleFixes.push(c);
      continue;
    }
    const asWord = rankedAsWord(c);
    // Spelling in a command is asked place by place: a batch's Tick all would reach every command at once.
    if (WORD_REWRITE_KINDS.has(c.kind) && onCommand(c)) (blocked(c) ? blockedGroups : asWord ? normal : demoted).add(c, true);
    else if (isTermFlag(c)) termFlags.push(c);
    else if (isOtherLanguageFlag(c)) otherLanguageFlags.push(c);
    else if (modules.namesCard && isNameFlag(c) && !asWord) names.push(c);
    else if (blocked(c)) blockedGroups.add(c);
    else if (!asWord && (fold(c) || (wordOf(c) !== null && lockedWords.has(wordOf(c)!)))) demoted.add(c);
    else normal.add(c);
  }

  // A likely or user-marked typo is ranked like any other word, not as a name.
  const scoreFor = (c: Candidate, batch: boolean) =>
    rankedAsWord(c) ? (WEIGHTS[c.kind] ?? DEFAULT_WEIGHT) + (batch ? 1 : 0) : scoreOf(c, batch);
  // Array.prototype.sort is stable, so equal scores keep first-appearance order.
  const byScore = (a: Decision, b: Decision) => b.score - a.score;
  // The simple-fixes card leads: one click clears the most changes.
  const card = simpleFixes.length ? [simpleFixesCard(simpleFixes, untickedOnCard(simpleFixes))] : [];
  const decisions = [...card, ...normal.toDecisions(scoreFor).sort(byScore)];
  const demotedDecisions = demoted.toDecisions(() => 0);
  const cards: Decision[] = [];
  if (termFlags.length) cards.push(termsCard(termFlags, terms));
  if (otherLanguageFlags.length) cards.push(otherLanguageCard(otherLanguageFlags));
  if (names.length) cards.push(namesCard(names));
  return {
    safe,
    decisions: [...decisions, ...demotedDecisions, ...cards],
    demoted: demotedDecisions.map((d) => d.id),
    blocked: blockedGroups.toDecisions(scoreFor).sort(byScore),
  };
}
