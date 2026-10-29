import { Dialect, LocalLinter, SuggestionKind } from 'harper.js';
import type { BinaryModule, LintConfig } from 'harper.js';
import type { Candidate, Paragraph, Span, Variant } from './types';
import { EN_IN_WORDS } from './wordlists/en-IN';
import { TECH_WORDS } from './wordlists/tech';
import { TECHNICAL_WORDS } from './wordlists/technical';

export interface RulesLinter {
  lintParagraphs(paras: Paragraph[], language: 'plaintext' | 'markdown'): Promise<Candidate[]>;
  /**
   * Spell check only (plaintext), under `variant`, without changing the current variant.
   * Used by variant detection: much cheaper than five full passes.
   */
  lintSpelling(paras: Paragraph[], variant: Variant): Promise<Candidate[]>;
  addWords(words: string[]): Promise<void>;
  setVariant(v: Variant): Promise<void>;
  readonly variant: Variant;
}

/** One of Harper's lints, copied out of WASM: a candidate without its paragraph. */
type LintCopy = Omit<Candidate, 'id' | 'paraId' | 'source'>;

const ARTICLE = /^an?$/i;

/**
 * An a ↔ an replacement in the original article's case. Harper upper-cases the whole replacement after a capital
 * "A" ("A apple" → "AN apple", F4 re-review 3, I-1): "A" and "An" are title case, "AN" is upper case.
 */
export function withArticleCase(original: string, replacement: string): string {
  if (!ARTICLE.test(original) || !ARTICLE.test(replacement)) return replacement;
  const lower = replacement.toLowerCase();
  if (original.length > 1 && original === original.toUpperCase()) return lower.toUpperCase();
  return original[0] === 'A' ? 'A' + lower.slice(1) : lower;
}

/**
 * The longest whitespace-free run Harper reads. A longer one is a key, a hash or a data URI: Harper took seconds
 * on 10,000 such characters and panicked on hex ones ("capacity overflow"), and a panic leaves its WASM unusable
 * for the rest of the process (Task F21d, review I-4).
 */
export const MAX_RUN_CHARACTERS = 200;
/** A whitespace-free run longer than MAX_RUN_CHARACTERS. */
const LONG_RUN = new RegExp(`\\S{${MAX_RUN_CHARACTERS + 1},}`, 'g');

/**
 * `text` with each long run replaced by as many spaces, so every offset stays exact, and where those runs were.
 * Harper reads the text before and after a run as usual; a flag touching a run is dropped (it gets no card).
 */
function withoutLongRuns(text: string): { readable: string; runs: Span[] } {
  const runs = [...text.matchAll(LONG_RUN)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  if (runs.length === 0) return { readable: text, runs };
  let readable = '';
  let at = 0;
  for (const r of runs) {
    readable += text.slice(at, r.start) + ' '.repeat(r.end - r.start);
    at = r.end;
  }
  return { readable: readable + text.slice(at), runs };
}

async function lintText(linter: LocalLinter, text: string, language: 'plaintext' | 'markdown'): Promise<LintCopy[]> {
  const out: LintCopy[] = [];
  const { readable, runs } = withoutLongRuns(text);
  for (const lint of await linter.lint(readable, { language })) {
    try {
      const sp = lint.span();
      const { start, end } = sp;
      sp.free();
      if (runs.some((r) => start < r.end && end > r.start)) continue;
      const original = text.slice(start, end);
      const replacements: string[] = [];
      for (const s of lint.suggestions()) {
        try {
          const k = s.kind();
          if (k === SuggestionKind.Remove) replacements.push('');
          else if (k === SuggestionKind.InsertAfter) replacements.push(original + s.get_replacement_text());
          else replacements.push(s.get_replacement_text());
        } finally {
          s.free();
        }
      }
      const fixes = replacements.map((r) => withArticleCase(original, r));
      out.push({ span: { start, end }, original, replacements: fixes, kind: lint.lint_kind(), message: lint.message() });
    } finally {
      lint.free();
    }
  }
  return out;
}

async function toCandidates(
  linter: LocalLinter,
  paras: Paragraph[],
  language: 'plaintext' | 'markdown',
): Promise<Candidate[]> {
  // A lint depends only on the text, so a repeated paragraph (a table's "Yes" or "N/A" cells) is linted once.
  const lintsByText = new Map<string, LintCopy[]>();
  const out: Candidate[] = [];
  for (const p of paras) {
    let lints = lintsByText.get(p.text);
    if (!lints) {
      lints = await lintText(linter, p.text, language);
      lintsByText.set(p.text, lints);
    }
    for (const { span, original, replacements, kind, message } of lints) {
      out.push({
        id: `${p.id}:${span.start}:${span.end}:${kind}`,
        paraId: p.id,
        span: { ...span },
        original,
        replacements: [...replacements], // each candidate owns its copies: the engine may change them
        kind,
        message,
        source: 'rules',
      });
    }
  }
  return out;
}

/**
 * `opts.binary` lets the UI pass `harper.js/binary` (separate .wasm asset).
 * Default is `harper.js/binaryInlined`, loaded lazily so the 25 MB file never
 * enters the static import graph of the engine.
 *
 * Harper rebuilds its rule set after `setDialect` (~100 ms per switch on the
 * first lint), so instead of switching one instance we keep one lazily created
 * instance per dialect (plus a spell-check-only one for detection). They share
 * the wasm module, so each costs only a few MB.
 */
export async function createLinter(
  variant: Variant,
  words: string[] = [],
  opts: { binary?: BinaryModule } = {},
): Promise<RulesLinter> {
  const binary = opts.binary ?? (await import('harper.js/binaryInlined')).binaryInlined;
  // Indian-English vocabulary is real vocabulary for Indian writers in every variant; so are tech and command words.
  const known: string[] = [...EN_IN_WORDS, ...TECH_WORDS, ...TECHNICAL_WORDS, ...words];
  const full = new Map<Variant, Promise<LocalLinter>>();
  const spell = new Map<Variant, Promise<LocalLinter>>();
  let spellOnly: LintConfig | undefined;

  const make = async (v: Variant, spellCheckOnly: boolean): Promise<LocalLinter> => {
    const l = new LocalLinter({ binary, dialect: Dialect[v] });
    await l.setup();
    if (spellCheckOnly) {
      if (!spellOnly) {
        const cfg = await l.getLintConfig();
        spellOnly = Object.fromEntries(Object.keys(cfg).map((k) => [k, k === 'SpellCheck'])) as LintConfig;
      }
      await l.setLintConfig(spellOnly);
    }
    if (known.length) await l.importWords([...known]);
    return l;
  };
  const get = (pool: Map<Variant, Promise<LocalLinter>>, v: Variant, spellCheckOnly: boolean) => {
    let l = pool.get(v);
    if (!l) {
      l = make(v, spellCheckOnly);
      pool.set(v, l);
    }
    return l;
  };

  let current = variant;
  await get(full, current, false);
  return {
    get variant() {
      return current;
    },
    async lintParagraphs(paras, language) {
      return toCandidates(await get(full, current, false), paras, language);
    },
    async lintSpelling(paras, v) {
      return toCandidates(await get(spell, v, true), paras, 'plaintext');
    },
    async addWords(w) {
      known.push(...w);
      const all = await Promise.all([...full.values(), ...spell.values()]);
      await Promise.all(all.map((l) => l.importWords(w)));
    },
    async setVariant(v) {
      await get(full, v, false);
      current = v;
    },
  };
}
