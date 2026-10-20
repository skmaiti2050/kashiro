import type { Candidate, Paragraph, Span, Tier } from './types';
import type { Preset } from './presets';

export interface TierContext {
  /** paraId → fact-locked spans (findLockedSpans + adapter Paragraph.locked). */
  locked: Map<number, Span[]>;
  /** Lowercased words in the document's own spelling variant (never auto-converted). */
  variantWords: Set<string>;
  preset: Preset;
  /** Keyed by candidate kind. */
  userTierOverrides?: Partial<Record<string, Tier>>;
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

export function overlapsLocked(c: Candidate, locked: Span[] | undefined): boolean {
  if (!locked) return false;
  const { start, end } = c.span;
  return locked.some((s) =>
    start === end ? s.start < start && start < s.end : start < s.end && s.start < end,
  );
}

function isArticleSwap(c: Candidate): boolean {
  if (c.kind !== 'Miscellaneous' || c.replacements.length !== 1) return false;
  const o = c.original.toLowerCase();
  const r = c.replacements[0].toLowerCase();
  return (o === 'a' && r === 'an') || (o === 'an' && r === 'a');
}

function baseTier(c: Candidate, ctx: TierContext): Tier {
  const { preset } = ctx;
  if (preset.hiddenKinds.includes(c.kind)) return 'hidden';
  if (preset.reviewKinds.includes(c.kind)) return 'review';

  const safeKind =
    c.source === 'hygiene' ||
    (c.source === 'rules' && (SAFE_RULE_KINDS.has(c.kind) || isArticleSwap(c)));
  return safeKind ? 'safe' : 'review';
}

/**
 * Risk tier for one candidate (spec §5). User overrides (by kind) win over the
 * fixed rules and the preset, but nothing becomes safe if it is LLM output, touches
 * a fact-locked span, lacks exactly one replacement, starts with a capital (names,
 * acronyms; except kind Capitalization) or is a word of the document's variant.
 */
export function tierOf(c: Candidate, ctx: TierContext): Tier {
  const override = ctx.userTierOverrides?.[c.kind];
  const tier = override ?? baseTier(c, ctx);
  if (tier !== 'safe') return tier;
  if (c.source === 'llm') return 'review';
  if (c.replacements.length !== 1) return 'review';
  if (UPPER_START.test(c.original) && c.kind !== 'Capitalization') return 'review';
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

function scoreOf(c: Candidate, batch: boolean): number {
  if (isNameFlag(c)) return 0;
  return (WEIGHTS[c.kind] ?? DEFAULT_WEIGHT) + (batch ? 1 : 0);
}

function singleLabel(c: Candidate): string {
  if (c.replacements.length === 0) return `${c.original}: ${c.message}`;
  return `${c.original} → ${c.replacements.join(' / ')}`;
}

/**
 * Safe candidates become auto-applied ids; review-tier candidates become decisions.
 * Review candidates with exactly one replacement and the same
 * `kind + lower(original) + '→' + replacement` collapse into one batch decision.
 * Hidden candidates are dropped. Decisions are sorted by score desc, ties in input order.
 */
export function buildDecisions(
  cands: Candidate[],
  tiers: Map<string, Tier>,
): { safe: string[]; decisions: Decision[] } {
  const safe: string[] = [];
  const groups = new Map<string, Candidate[]>();
  const order: { key: string | null; c: Candidate }[] = [];

  for (const c of cands) {
    const t = tiers.get(c.id) ?? 'review';
    if (t === 'hidden') continue;
    if (t === 'safe') {
      safe.push(c.id);
      continue;
    }
    if (c.replacements.length === 1) {
      const key = c.kind + c.original.toLowerCase() + '→' + c.replacements[0];
      const g = groups.get(key);
      if (g) g.push(c);
      else {
        groups.set(key, [c]);
        order.push({ key, c });
      }
    } else {
      order.push({ key: null, c });
    }
  }

  const decisions: Decision[] = order.map(({ key, c }) => {
    const g = key === null ? [c] : groups.get(key)!;
    if (g.length > 1) {
      return {
        id: `batch:${key}`,
        kind: 'batch',
        candidateIds: g.map((x) => x.id),
        label: `${c.original} → ${c.replacements[0]} (${g.length} places)`,
        score: scoreOf(c, true),
      };
    }
    return { id: c.id, kind: 'single', candidateIds: [c.id], label: singleLabel(c), score: scoreOf(c, false) };
  });

  // Array.prototype.sort is stable, so equal scores keep first-appearance order.
  decisions.sort((a, b) => b.score - a.score);
  return { safe, decisions };
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

/** Academic preset: flags contractions with their full forms (kind 'Contraction', source 'preset'). */
export function findContractions(p: Paragraph): Candidate[] {
  const out: Candidate[] = [];
  const re = /(?<![\p{L}\p{N}'’])[\p{L}]+['’][\p{L}]+(?![\p{L}\p{N}])/gu;
  for (const m of p.text.matchAll(re)) {
    const original = m[0];
    const full = CONTRACTIONS[original.toLowerCase().replace('’', "'")];
    if (!full) continue;
    const start = m.index!;
    const end = start + original.length;
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
