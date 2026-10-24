import type { Candidate, Span, Tier, Variant } from './types';
import type { Preset } from './presets';
import { followsAbbreviation, isSentenceStart, overlapsLocked } from './factLock';
import { doubledWord, HAS_DIGIT, isCodeNoiseFlag, isSlipFix, UPPER_START, WORD_REWRITE_KINDS } from './wordFlags';
import { overlaps } from './sessionTypes';
import { isRomanisedIndic } from './romanised/classifier';
import type { ModuleSwitches } from './modules';
import { isListLabelFlag, lowersAcronym } from './listItems';
import { isConfusableFlag } from './confusables';

// Public paths stay `engine/tiers`; the implementations live next to their own helpers.
export { buildDecisions, foldsUnderMore, type Decision } from './decisions';
export { findContractions } from './contractions';

export interface TierContext {
  /** paraId → fact-locked spans (findLockedSpans + adapter Paragraph.locked). */
  locked: Map<number, Span[]>;
  /** Lowercased words in the document's own spelling variant (never auto-converted). */
  variantWords: Set<string>;
  preset: Preset;
  /** Keyed by candidate kind. */
  userTierOverrides?: Partial<Record<string, Tier>>;
  /** Kinds the user dismissed as a rule ("This rule in this document / everywhere"): hidden, see isIgnoredRule. */
  ignoredKinds?: ReadonlySet<string>;
  /** paraId → paragraph text, for context-dependent safety rules. */
  paraText?: Map<number, string>;
  /** The document's spelling variant (some suggestions are wrong for some variants). */
  variant?: Variant;
  /** paraId → sentences mostly in another language (findForeignSentences): no word there is auto-fixed. */
  foreignSentences?: Map<number, Span[]>;
  /** paraId → sentences with a romanised Indian-language word (findRomanisedSentences): no two-letter fix there. */
  romanisedSentences?: Map<number, Span[]>;
  /** The optional modules this check runs with (default DEFAULT_MODULES). */
  modules?: ModuleSwitches;
  /** Ids of list-item paragraphs (Paragraph.listItem): their first word is not a sentence start. */
  listParagraphs?: ReadonlySet<number>;
  /** paraId → offsets of the invisible characters hygiene deletes (findInvisible). */
  invisibleAt?: Map<number, ReadonlySet<number>>;
}

// Repetition is not here: only isSlipDoubling's words are safe to undouble.
const SAFE_RULE_KINDS = new Set(['Spelling', 'Typo', 'Punctuation', 'Capitalization', 'Formatting']);

/**
 * Words whose doubling is always a slip ("the the", "of of"). Others double in correct English, so their
 * repetition is reviewed: "He had had enough", "that that was", "What it is is", "What it was was",
 * "log in in the morning", "turn it on on Monday", "look at at least", "I do do care" (review #4, C1).
 */
const ALWAYS_SLIP_DOUBLINGS = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'for', 'with', 'be']);

/**
 * A Repetition flag that is safe to apply unasked: an ALWAYS_SLIP_DOUBLINGS word written twice (doubledWord),
 * fixed by keeping the first. A capitalised first copy must start a sentence ("The the cat"), not be a name
 * or a label ("Plan A a day").
 */
function isSlipDoubling(c: Candidate, text: string | undefined): boolean {
  const word = doubledWord(c);
  if (word === null || !ALWAYS_SLIP_DOUBLINGS.has(word)) return false;
  return c.original.startsWith(word) || (text !== undefined && isSentenceStart(text, c.span.start));
}

/** The next word and the space before it, invisible characters included, without punctuation: " m<U+2060>ean". */
const NEXT_TOKEN = /^\s*[^\s\p{P}]*/u;

/**
 * True when an invisible character hygiene deletes sits inside the flag, right before it, or in the word
 * after it. The linter read the text without it, but the paragraph still holds it, so neither the span
 * nor a check of the next word (isArticleSwap) is what the reader sees: "a m<U+2060>ean" (review #4, C3).
 */
function nearInvisible(c: Candidate, ctx: TierContext): boolean {
  const at = ctx.invisibleAt?.get(c.paraId);
  if (!at || at.size === 0) return false;
  const after = NEXT_TOKEN.exec(ctx.paraText?.get(c.paraId)?.slice(c.span.end) ?? '')![0].length;
  for (let i = c.span.start - 1; i <= c.span.end + after; i++) if (at.has(i)) return true;
  return false;
}

/** Function words (pronouns, articles, auxiliaries, prepositions…). After one, an a/an swap is likely the wrong fix ("an there was" is a typo of "and there was"); the LLM guard ignores them when comparing content words. */
export const FUNCTION_WORDS = new Set(
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

/**
 * Harper splits closed compounds ("roadmap" → "road map", WordChoice) and joins hyphenated prefixes
 * ("non-public" → "nonpublic", "co-operative" → "cooperative", Spelling). British and Indian English write
 * both forms, so neither is a fix there. Real boundary errors ("atleast" → "at least") are BoundaryError.
 */
function isUnwantedCompoundChange(c: Candidate, variant: Variant | undefined): boolean {
  if ((variant !== 'British' && variant !== 'Indian') || c.replacements.length !== 1) return false;
  const [r] = c.replacements;
  // Only Harper's bare "Did you mean `road map`?": "You probably mean the adverb `every day`" is grammar.
  const split =
    c.kind === 'WordChoice' &&
    c.message === `Did you mean \`${r}\`?` &&
    !c.original.includes(' ') &&
    r.includes(' ') &&
    r.replaceAll(' ', '') === c.original;
  const joined = c.kind === 'Spelling' && c.original.includes('-') && !r.includes('-') && c.original.replaceAll('-', '') === r;
  return split || joined;
}

/** Harper's title-case advice for headings is a house-style choice (spec §2: don't nag bloggers about it). */
const HEADING_TITLE_CASE = 'Try to use title case in headings.';

/** An en or em dash: "–", "—". */
const DASH = /[–—]/;

/**
 * Typographic and comma choices that are style, not errors, so they are never applied unasked:
 * a dash conversion ("--" → "–": old texts write "--" for an em dash, and Harper offers the en dash)
 * and an introductory comma ("Therefore" → "Therefore,").
 */
function isStyleChoice(c: Candidate): boolean {
  if (c.kind === 'Formatting' && c.replacements.some((r) => DASH.test(r) && !DASH.test(c.original))) return true;
  // The word itself is the span ("Therefore" → "Therefore,"); a bare comma insertion is not this rule.
  return c.kind === 'Punctuation' && c.original !== '' && c.replacements.length === 1 && c.replacements[0] === `${c.original},`;
}

/**
 * A flagged word that is likely romanised Indian-language (prakriti → Prakrit, dharshan → darshan) or sits in a
 * sentence mostly in another language (Bengali "te" → the), or is a two-letter word in a sentence with a
 * romanised word (Punjabi "te" in "dhaba te ate makki di roti"): its one-letter "fix" would change the language.
 */
function isOtherLanguageWord(c: Candidate, ctx: TierContext): boolean {
  // Protection skips the English-frequency gate: "na" in "Come fast na" is common as N/A but still Hindi here.
  if (isRomanisedIndic(c.original, true)) return true;
  const inAny = (sentences: Map<number, Span[]> | undefined) => (sentences?.get(c.paraId) ?? []).some((s) => overlaps(c.span, s));
  return inAny(ctx.foreignSentences) || (c.original.length === 2 && inAny(ctx.romanisedSentences));
}

/**
 * A flag of a rule the user dismissed. LLM rewrites, hygiene fixes and flags on fact-locked text are never
 * affected: the dismiss menu only quiets the rules passes, never the protections. Nor are word flags
 * (Spelling/Typo): hiding them all would hide every typo; they are answered per word, with the dictionary.
 */
function isIgnoredRule(c: Candidate, ctx: TierContext): boolean {
  if (!ctx.ignoredKinds?.has(c.kind) || c.source === 'llm' || c.source === 'hygiene') return false;
  if (WORD_REWRITE_KINDS.has(c.kind)) return false;
  return !overlapsLocked(c, ctx.locked.get(c.paraId));
}

function baseTier(c: Candidate, ctx: TierContext): Tier {
  const { preset } = ctx;
  if (isStyleChoice(c)) return 'review';
  if (c.kind === 'Capitalization' && c.message === HEADING_TITLE_CASE) return 'hidden';
  if (isUnwantedOxfordComma(c, ctx.variant)) return 'hidden';
  if (isUnwantedCompoundChange(c, ctx.variant)) return 'hidden';
  if (preset.hiddenKinds.includes(c.kind)) return 'hidden';
  if (preset.reviewKinds.includes(c.kind)) return 'review';

  const text = ctx.paraText?.get(c.paraId);
  const safeKind =
    c.source === 'hygiene' ||
    (c.source === 'rules' &&
      (SAFE_RULE_KINDS.has(c.kind) || isArticleSwap(c, text) || (c.kind === 'Repetition' && isSlipDoubling(c, text))));
  return safeKind ? 'safe' : 'review';
}

/**
 * Risk tier for one candidate (spec §5). User overrides (by kind) win over the
 * fixed rules and the preset, but nothing becomes safe if it is LLM output, touches
 * a fact-locked span, lacks exactly one replacement, is a Spelling/Typo fix of a word starting
 * with a capital (names, acronyms) or more than one letter away (see isSlipFix), or is a word
 * of the document's variant, holds a digit ("y0u") or is a word in another language (isOtherLanguageWord).
 * Spelling/Typo/Capitalization flags on code tokens
 * ("q2", "preventDefault", "src/ui") and respellings of stray single letters are always hidden, and so are
 * kinds the user dismissed as a rule (isIgnoredRule).
 */
export function tierOf(c: Candidate, ctx: TierContext): Tier {
  const paraText = ctx.paraText?.get(c.paraId);
  if (isCodeNoiseFlag(c, paraText)) return 'hidden';
  if (lowersAcronym(c)) return 'hidden';
  if (paraText !== undefined && isListLabelFlag(c, paraText, ctx.listParagraphs?.has(c.paraId) ?? false)) return 'hidden';
  if (isIgnoredRule(c, ctx)) return 'hidden';
  const override = ctx.userTierOverrides?.[c.kind];
  const tier = override ?? baseTier(c, ctx);
  if (tier !== 'safe') return tier;
  // Whatever the overrides say: a grammatical doubling, or a flag an invisible character skews, is asked first.
  if (c.kind === 'Repetition' && !isSlipDoubling(c, paraText)) return 'review';
  if (c.source !== 'hygiene' && nearInvisible(c, ctx)) return 'review';
  // "y0u" → "you" is likely right, but a token with a digit may be a code nobody recognised: ask first.
  if (WORD_REWRITE_KINDS.has(c.kind) && HAS_DIGIT.test(c.original)) return 'review';
  if (c.source === 'llm' || isConfusableFlag(c)) return 'review';
  // Safety rests on the linter's own list: one it offered alone, not one the engine filtered or added to.
  if (c.replacements.length !== 1 || c.linterReplacements) return 'review';
  if (WORD_REWRITE_KINDS.has(c.kind) && (UPPER_START.test(c.original) || !isSlipFix(c))) return 'review';
  if (WORD_REWRITE_KINDS.has(c.kind) && isOtherLanguageWord(c, ctx)) return 'review';
  // "Mr. and Mrs. Rao": the linter reads the abbreviation's period as a sentence end.
  const text = ctx.paraText?.get(c.paraId);
  if (c.kind === 'Capitalization' && text !== undefined && followsAbbreviation(text, c.span.start)) return 'review';
  if (ctx.variantWords.has(c.original.toLowerCase())) return 'review';
  if (overlapsLocked(c, ctx.locked.get(c.paraId))) return 'review';
  return 'safe';
}
