import type { Candidate, Paragraph, Span, Tier, Variant } from './types';
import type { Preset } from './presets';
import { followsAbbreviation, isSentenceStart } from './factLock';

export interface TierContext {
  /** paraId → fact-locked spans (findLockedSpans + adapter Paragraph.locked). */
  locked: Map<number, Span[]>;
  /** Lowercased words in the document's own spelling variant (never auto-converted). */
  variantWords: Set<string>;
  preset: Preset;
  /** Keyed by candidate kind. */
  userTierOverrides?: Partial<Record<string, Tier>>;
  /** paraId → paragraph text, for context-dependent safety rules. */
  paraText?: Map<number, string>;
  /** The document's spelling variant (some suggestions are wrong for some variants). */
  variant?: Variant;
}

export interface Decision {
  /** `batch:<key>` for a batch, the candidate id for a single, `names` for the names card. */
  id: string;
  kind: 'single' | 'batch' | 'names';
  candidateIds: string[];
  label: string;
  score: number;
  /**
   * Names card only: pairs of its words one edit apart, in order of appearance (["Pirya", "Priya"]).
   * One of each pair is probably a typo of the other, so the UI pre-unticks it.
   */
  nearDuplicates?: [string, string][];
}

const SAFE_RULE_KINDS = new Set(['Spelling', 'Typo', 'Repetition', 'Punctuation', 'Capitalization', 'Formatting']);
const UPPER_START = /^\p{Lu}/u;
/** Kinds that rewrite a word into a dictionary word: on a capitalised original that is likely a name. */
const WORD_REWRITE_KINDS = new Set(['Spelling', 'Typo']);

export function overlapsLocked(c: Candidate, locked: Span[] | undefined): boolean {
  if (!locked) return false;
  const { start, end } = c.span;
  return locked.some((s) =>
    start === end ? s.start < start && start < s.end : start < s.end && s.start < end,
  );
}

/** Words after which an a/an swap is likely the wrong fix ("an there was" is a typo of "and there was"). */
const FUNCTION_WORDS = new Set(
  (
    'i you he she it we they me him her us them my your his its our their mine yours ours theirs ' +
    'this that these those who whom whose what which when where why how there here ' +
    'and or but nor so yet if because as than then while although though unless whether ' +
    'a an the some any every each no all both either neither much many few more most other another such ' +
    'is are was were be been being am do does did done have has had will would shall should can could may might must ' +
    'not of in on at to for with by from into onto upon about over under ' +
    'now also just only very still even never always often soon too'
  ).split(' '),
);

/** The word right after an article, e.g. "apple" in "a apple fell". */
const NEXT_WORD = /^\s+([\p{L}\p{N}'’-]+)/u;
/** A lowercase word without apostrophes ("apple", "well-known"; not "isn't", "Rao", "8"). */
const LOWERCASE_PLAIN_WORD = /^\p{Ll}[\p{Ll}-]*$/u;

/**
 * a ↔ an, only when the next word is a lowercase content word ("a apple"). Before a function word,
 * a contraction, punctuation, the end of the text, a capitalised name, an acronym or a number the
 * "fix" is often wrong ("an they" means "and they"), so it is not an article swap for safety purposes.
 */
function isArticleSwap(c: Candidate, text: string | undefined): boolean {
  if (c.kind !== 'Miscellaneous' || c.replacements.length !== 1 || text === undefined) return false;
  const o = c.original.toLowerCase();
  const r = c.replacements[0].toLowerCase();
  if (!((o === 'a' && r === 'an') || (o === 'an' && r === 'a'))) return false;
  const next = NEXT_WORD.exec(text.slice(c.span.end))?.[1];
  if (!next || !LOWERCASE_PLAIN_WORD.test(next)) return false;
  return !FUNCTION_WORDS.has(next);
}

/** Harper asks for the Oxford comma in every variant; British and Indian English usually omit it. */
function isUnwantedOxfordComma(c: Candidate, variant: Variant | undefined): boolean {
  return (
    (variant === 'British' || variant === 'Indian') &&
    c.kind === 'Style' &&
    c.message.startsWith('An Oxford comma is necessary')
  );
}

/** Harper's title-case advice for headings is a house-style choice (spec §2: don't nag bloggers about it). */
const HEADING_TITLE_CASE = 'Try to use title case in headings.';

function baseTier(c: Candidate, ctx: TierContext): Tier {
  const { preset } = ctx;
  if (c.kind === 'Capitalization' && c.message === HEADING_TITLE_CASE) return 'hidden';
  if (isUnwantedOxfordComma(c, ctx.variant)) return 'hidden';
  if (preset.hiddenKinds.includes(c.kind)) return 'hidden';
  if (preset.reviewKinds.includes(c.kind)) return 'review';

  const safeKind =
    c.source === 'hygiene' ||
    (c.source === 'rules' && (SAFE_RULE_KINDS.has(c.kind) || isArticleSwap(c, ctx.paraText?.get(c.paraId))));
  return safeKind ? 'safe' : 'review';
}

/**
 * Risk tier for one candidate (spec §5). User overrides (by kind) win over the
 * fixed rules and the preset, but nothing becomes safe if it is LLM output, touches
 * a fact-locked span, lacks exactly one replacement, is a Spelling/Typo fix of a word starting
 * with a capital (names, acronyms) or more than one letter away (see isSlipFix), or is a word
 * of the document's variant.
 */
export function tierOf(c: Candidate, ctx: TierContext): Tier {
  const override = ctx.userTierOverrides?.[c.kind];
  const tier = override ?? baseTier(c, ctx);
  if (tier !== 'safe') return tier;
  if (c.source === 'llm') return 'review';
  if (c.replacements.length !== 1) return 'review';
  if (WORD_REWRITE_KINDS.has(c.kind) && (UPPER_START.test(c.original) || !isSlipFix(c))) return 'review';
  // "Mr. and Mrs. Rao": the linter reads the abbreviation's period as a sentence end.
  const text = ctx.paraText?.get(c.paraId);
  if (c.kind === 'Capitalization' && text !== undefined && followsAbbreviation(text, c.span.start)) return 'review';
  if (ctx.variantWords.has(c.original.toLowerCase())) return 'review';
  if (overlapsLocked(c, ctx.locked.get(c.paraId))) return 'review';
  return 'safe';
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

/** Capitalised-word Spelling/Typo flags are almost always names (spec §5 names card). */
function isNameFlag(c: Candidate): boolean {
  return WORD_REWRITE_KINDS.has(c.kind) && UPPER_START.test(c.original);
}

/** A capital then lowercase letters ("Teh", "Priya"; not "NPCI", "MEGHNA" or "A."). */
const TITLE_CASE_WORD = /^\p{Lu}\p{Ll}+$/u;

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

/** True when `word` (exact case) appears somewhere in the document other than at a sentence start. */
function usedMidSentence(word: string, paraText: ReadonlyMap<number, string>): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The whole word, e.g. "Rao" in "met Rao." but not in "Raona".
  const wholeWord = new RegExp(`(?<![\\p{L}\\p{N}'’])${escaped}(?![\\p{L}\\p{N}'’])`, 'gu');
  for (const text of paraText.values()) {
    for (const m of text.matchAll(wholeWord)) if (!isSentenceStart(text, m.index!)) return true;
  }
  return false;
}

/**
 * A capitalised flag that is probably a typo, not a name: it starts a sentence (so its capital says
 * nothing), it has a one-letter fix ("Teh" → "The"), and the document never capitalises it mid-sentence,
 * where a name would be capitalised too. A word in capitals ("NPCI", a speaker label "MEGHNA") is never
 * one: its capitals are not from the sentence start. Without paragraph text nothing counts as a likely typo.
 */
function isLikelyTypo(c: Candidate, paraText: ReadonlyMap<number, string> | undefined): boolean {
  const text = paraText?.get(c.paraId);
  if (!paraText || text === undefined || !isNameFlag(c) || !TITLE_CASE_WORD.test(c.original)) return false;
  if (!isSentenceStart(text, c.span.start) || !c.replacements.some((r) => isSlip(c.original, r))) return false;
  return !usedMidSentence(c.original, paraText);
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

/** Damerau-Levenshtein (optimal string alignment) distance, case-insensitive, stopping early above 1. */
function withinOneEdit(a: string, b: string): boolean {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (Math.abs(a.length - b.length) > 1) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length] <= 1;
}

const PLAIN_WORD = /^[\p{L}'’]+$/u;

/**
 * A dictionary fix is only safe when it is a plain slip of one letter inside one word (teh → the,
 * occured → occurred, dont → don't). Bigger jumps (panchayat → penchant) usually mean an unknown word,
 * not a typo, and joining or splitting words (borewell → bore well, up stairs → upstairs,
 * mid-day → midday) is a meaning or style choice: auto-applying them can change meaning.
 */
function isSlipFix(c: Candidate): boolean {
  return isSlip(c.original, c.replacements[0]);
}

function isSlip(original: string, replacement: string): boolean {
  return PLAIN_WORD.test(original) && PLAIN_WORD.test(replacement) && withinOneEdit(original, replacement);
}

function scoreOf(c: Candidate, batch: boolean): number {
  if (isNameFlag(c)) return 0;
  return (WEIGHTS[c.kind] ?? DEFAULT_WEIGHT) + (batch ? 1 : 0);
}

function singleLabel(c: Candidate): string {
  if (c.replacements.length === 0) return `${c.original}: ${c.message}`;
  return `${c.original} → ${c.replacements.join(' / ')}`;
}

/**
 * The batch key of a review candidate (spec §5: "the same correction repeated → one decision"):
 * - Spelling/Typo: kind + lowercased word, whatever the suggestions. One decision per flagged word
 *   ("Sujit (12 places)"), resolved by adding it to the dictionary, ignoring all, or one replacement for all.
 * - exactly one replacement: kind + lower(original) + '→' + lower(replacement) (each member keeps its own
 *   replacement on accept, so "It's → Its" keeps its capital).
 * - otherwise (no fix, or a choice): kind + lower(original) + message, i.e. the identical flag repeated.
 */
export function batchKey(c: Candidate): string {
  const o = c.original.toLowerCase();
  if (WORD_REWRITE_KINDS.has(c.kind)) return `word:${c.kind}:${o}`;
  if (c.replacements.length === 1) return c.kind + o + '→' + c.replacements[0].toLowerCase();
  return `flag:${c.kind}:${o}:${c.message}`;
}

function batchLabel(c: Candidate, n: number): string {
  if (WORD_REWRITE_KINDS.has(c.kind)) {
    const fixes = c.replacements.length ? ` → ${c.replacements.join(' / ')}` : '';
    return `${c.original}${fixes} (${n} places)`;
  }
  return `${singleLabel(c)} (${n} places)`;
}

export interface DecisionOptions {
  /** Candidates on fact-locked spans: demoted (see buildDecisions). */
  fold?: (c: Candidate) => boolean;
  /** Lowercased words the user unticked on the names card: real typos, ranked as words. */
  typoWords?: ReadonlySet<string>;
  /** paraId → paragraph text, to tell a sentence-initial typo from a name (isLikelyTypo). */
  paraText?: ReadonlyMap<number, string>;
  /** Candidates that cannot be applied (inside an existing tracked change): returned in `blocked`. */
  blocked?: (c: Candidate) => boolean;
}

/** Decisions grouped by batch key, in first-appearance order. */
class DecisionGroups {
  private readonly groups = new Map<string, Candidate[]>();

  add(c: Candidate): void {
    const key = batchKey(c);
    const g = this.groups.get(key);
    if (g) g.push(c);
    else this.groups.set(key, [c]);
  }

  toDecisions(score: (c: Candidate, batch: boolean) => number): Decision[] {
    return [...this.groups].map(([key, g]): Decision => {
      const c = g[0];
      if (g.length > 1) {
        return { id: `batch:${key}`, kind: 'batch', candidateIds: g.map((x) => x.id), label: batchLabel(c, g.length), score: score(c, true) };
      }
      return { id: c.id, kind: 'single', candidateIds: [c.id], label: singleLabel(c), score: score(c, false) };
    });
  }
}

/**
 * Safe candidates become auto-applied ids; review-tier candidates become decisions, batched by
 * `batchKey` (members in input order). Hidden candidates are dropped. Decisions are sorted by score
 * desc, ties in input order.
 * Demoted (never dropped): candidates matching `fold` (fact-locked spans) and Spelling/Typo flags of a
 * word that `fold` matched elsewhere (a name everywhere). They batch among themselves, get score 0 and
 * rank after every other decision, so they only reach the top when there is room. `demoted` lists
 * their decision ids.
 * Names: every capitalised Spelling/Typo flag goes on one names card, ranked last (spec §5), except
 * likely typos (isLikelyTypo) and Spelling/Typo flags of words in `typoWords`: those rank like any word.
 * Blocked candidates go into `blocked` (scored and sorted the same way), except name flags, which join
 * the one names card: adding a name to the dictionary changes no text.
 */
export function buildDecisions(
  cands: Candidate[],
  tiers: Map<string, Tier>,
  { fold = () => false, typoWords = new Set(), paraText, blocked = () => false }: DecisionOptions = {},
): { safe: string[]; decisions: Decision[]; demoted: string[]; blocked: Decision[] } {
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
  for (const c of cands) {
    const t = tiers.get(c.id) ?? 'review';
    if (t === 'hidden') continue;
    if (t === 'safe') {
      safe.push(c.id);
      continue;
    }
    const asWord = rankedAsWord(c);
    if (isNameFlag(c) && !asWord) names.push(c);
    else if (blocked(c)) blockedGroups.add(c);
    else if (!asWord && (fold(c) || (wordOf(c) !== null && lockedWords.has(wordOf(c)!)))) demoted.add(c);
    else normal.add(c);
  }

  // A likely or user-marked typo is ranked like any other word, not as a name.
  const scoreFor = (c: Candidate, batch: boolean) =>
    rankedAsWord(c) ? (WEIGHTS[c.kind] ?? DEFAULT_WEIGHT) + (batch ? 1 : 0) : scoreOf(c, batch);
  // Array.prototype.sort is stable, so equal scores keep first-appearance order.
  const byScore = (a: Decision, b: Decision) => b.score - a.score;
  const decisions = normal.toDecisions(scoreFor).sort(byScore);
  const demotedDecisions = demoted.toDecisions(() => 0);
  const card = names.length ? [namesCard(names)] : [];
  return {
    safe,
    decisions: [...decisions, ...demotedDecisions, ...card],
    demoted: demotedDecisions.map((d) => d.id),
    blocked: blockedGroups.toDecisions(scoreFor).sort(byScore),
  };
}

const CONTRACTIONS: Record<string, string[]> = {
  "can't": ['cannot'],
  "won't": ['will not'],
  "shan't": ['shall not'],
  "don't": ['do not'],
  "doesn't": ['does not'],
  "didn't": ['did not'],
  "isn't": ['is not'],
  "aren't": ['are not'],
  "wasn't": ['was not'],
  "weren't": ['were not'],
  "haven't": ['have not'],
  "hasn't": ['has not'],
  "hadn't": ['had not'],
  "wouldn't": ['would not'],
  "shouldn't": ['should not'],
  "couldn't": ['could not'],
  "mustn't": ['must not'],
  "needn't": ['need not'],
  "i'm": ['I am'],
  "you're": ['you are'],
  "we're": ['we are'],
  "they're": ['they are'],
  "i've": ['I have'],
  "you've": ['you have'],
  "we've": ['we have'],
  "they've": ['they have'],
  "i'll": ['I will'],
  "you'll": ['you will'],
  "he'll": ['he will'],
  "she'll": ['she will'],
  "it'll": ['it will'],
  "we'll": ['we will'],
  "they'll": ['they will'],
  "i'd": ['I would', 'I had'],
  "you'd": ['you would', 'you had'],
  "he'd": ['he would', 'he had'],
  "she'd": ['she would', 'she had'],
  "we'd": ['we would', 'we had'],
  "they'd": ['they would', 'they had'],
  "it's": ['it is', 'it has'],
  "he's": ['he is', 'he has'],
  "she's": ['she is', 'she has'],
  "that's": ['that is', 'that has'],
  "there's": ['there is', 'there has'],
  "what's": ['what is', 'what has'],
  "who's": ['who is', 'who has'],
  "let's": ['let us'],
};

function matchCase(original: string, full: string): string {
  const letters = original.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) return full.toUpperCase();
  if (UPPER_START.test(original)) return full[0].toUpperCase() + full.slice(1);
  return full;
}

/**
 * Academic preset: flags contractions with their full forms (kind 'Contraction', source 'preset').
 * Contractions inside `locked` spans (quotes, code, citations) are skipped.
 */
export function findContractions(p: Paragraph, locked: Span[] = []): Candidate[] {
  const out: Candidate[] = [];
  const re = /(?<![\p{L}\p{N}'’])[\p{L}]+['’][\p{L}]+(?![\p{L}\p{N}])/gu;
  for (const m of p.text.matchAll(re)) {
    const original = m[0];
    const full = CONTRACTIONS[original.toLowerCase().replace('’', "'")];
    if (!full) continue;
    const start = m.index!;
    const end = start + original.length;
    if (locked.some((s) => start < s.end && s.start < end)) continue;
    out.push({
      id: `${p.id}:${start}:${end}:Contraction`,
      paraId: p.id,
      span: { start, end },
      original,
      replacements: full.map((f) => matchCase(original, f)),
      kind: 'Contraction',
      message: 'Contraction in formal writing; consider the full form.',
      source: 'preset',
    });
  }
  return out;
}
