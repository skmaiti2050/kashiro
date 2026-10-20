import type { Candidate, Paragraph, Span, Tier, Variant } from './types';
import type { Preset } from './presets';
import { followsAbbreviation } from './factLock';

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
  /** `batch:<key>` for a batch, the candidate id for a single. */
  id: string;
  kind: 'single' | 'batch';
  candidateIds: string[];
  label: string;
  score: number;
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

/** Words after which an a/an swap is likely the wrong fix (e.g. "an they" is a typo of "and"). */
const FUNCTION_WORDS = new Set(
  (
    'i you he she it we they me him her us them my your his its our their mine yours ours theirs ' +
    'this that these those who whom whose what which ' +
    'and or but nor so yet if because as than then while although though unless whether ' +
    'a an the some any every each no all both either neither much many few more most other another such ' +
    'is are was were be been being am do does did done have has had will would shall should can could may might must ' +
    'not of in on at to for with by from into onto upon about over under'
  ).split(' '),
);

/**
 * a ↔ an, only when the next word is a lowercase content word ("a apple"). Before a function word,
 * punctuation, the end of the text, a capitalised name, an acronym or a number the "fix" is often
 * wrong ("an they" means "and they"), so it is not an article swap for safety purposes.
 */
function isArticleSwap(c: Candidate, text: string | undefined): boolean {
  if (c.kind !== 'Miscellaneous' || c.replacements.length !== 1 || text === undefined) return false;
  const o = c.original.toLowerCase();
  const r = c.replacements[0].toLowerCase();
  if (!((o === 'a' && r === 'an') || (o === 'an' && r === 'a'))) return false;
  const next = /^\s+([\p{L}\p{N}'’-]+)/u.exec(text.slice(c.span.end))?.[1];
  if (!next || !/^\p{Ll}[\p{Ll}'’-]*$/u.test(next)) return false;
  return !FUNCTION_WORDS.has(next.toLowerCase());
}

/** Harper asks for the Oxford comma in every variant; British and Indian English usually omit it. */
function isUnwantedOxfordComma(c: Candidate, variant: Variant | undefined): boolean {
  return (
    (variant === 'British' || variant === 'Indian') &&
    c.kind === 'Style' &&
    c.message.startsWith('An Oxford comma is necessary')
  );
}

function baseTier(c: Candidate, ctx: TierContext): Tier {
  const { preset } = ctx;
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

/** Capitalised-word Spelling flags are almost always names: rank them last. */
function isNameFlag(c: Candidate): boolean {
  return c.kind === 'Spelling' && UPPER_START.test(c.original);
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
  const r = c.replacements[0];
  return PLAIN_WORD.test(c.original) && PLAIN_WORD.test(r) && withinOneEdit(c.original, r);
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

/**
 * Safe candidates become auto-applied ids; review-tier candidates become decisions, batched by
 * `batchKey` (members in input order). Hidden candidates are dropped. Decisions are sorted by score
 * desc, ties in input order.
 * Demoted (never dropped): candidates matching `fold` (fact-locked spans) and Spelling/Typo flags of a
 * word that `fold` matched elsewhere (a name everywhere). They batch among themselves, get score 0 and
 * rank after every other decision, so they only reach the top when there is room. `demoted` lists
 * their decision ids.
 */
export function buildDecisions(
  cands: Candidate[],
  tiers: Map<string, Tier>,
  fold: (c: Candidate) => boolean = () => false,
): { safe: string[]; decisions: Decision[]; demoted: string[] } {
  const safe: string[] = [];
  const wordOf = (c: Candidate) => (WORD_REWRITE_KINDS.has(c.kind) ? c.kind + c.original.toLowerCase() : null);
  // A word the document uses as a fact-locked name somewhere is a name everywhere (e.g. sentence-initial).
  const lockedWords = new Set(cands.filter((c) => wordOf(c) !== null && fold(c)).map((c) => wordOf(c)!));

  const group = () => ({ groups: new Map<string, Candidate[]>(), order: [] as string[] });
  const normal = group();
  const demoted = group();
  for (const c of cands) {
    const t = tiers.get(c.id) ?? 'review';
    if (t === 'hidden') continue;
    if (t === 'safe') {
      safe.push(c.id);
      continue;
    }
    const isDemoted = fold(c) || (wordOf(c) !== null && lockedWords.has(wordOf(c)!));
    const into = isDemoted ? demoted : normal;
    const key = batchKey(c);
    const g = into.groups.get(key);
    if (g) g.push(c);
    else {
      into.groups.set(key, [c]);
      into.order.push(key);
    }
  }

  const toDecisions = ({ groups, order }: ReturnType<typeof group>, score: (c: Candidate, batch: boolean) => number) =>
    order.map((key): Decision => {
      const g = groups.get(key)!;
      const c = g[0];
      if (g.length > 1) {
        return { id: `batch:${key}`, kind: 'batch', candidateIds: g.map((x) => x.id), label: batchLabel(c, g.length), score: score(c, true) };
      }
      return { id: c.id, kind: 'single', candidateIds: [c.id], label: singleLabel(c), score: score(c, false) };
    });

  const decisions = toDecisions(normal, scoreOf);
  // Array.prototype.sort is stable, so equal scores keep first-appearance order.
  decisions.sort((a, b) => b.score - a.score);
  const demotedDecisions = toDecisions(demoted, () => 0);
  return { safe, decisions: [...decisions, ...demotedDecisions], demoted: demotedDecisions.map((d) => d.id) };
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
