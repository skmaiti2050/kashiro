import { Dialect, LocalLinter, SuggestionKind } from 'harper.js';
import type { BinaryModule, LintConfig } from 'harper.js';
import type { Candidate, Paragraph, Variant } from './types';
import { EN_IN_WORDS } from './wordlists/en-IN';
import { TECH_WORDS } from './wordlists/tech';

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

async function toCandidates(
  linter: LocalLinter,
  paras: Paragraph[],
  language: 'plaintext' | 'markdown',
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const p of paras) {
    const lints = await linter.lint(p.text, { language });
    for (const lint of lints) {
      try {
        const sp = lint.span();
        const { start, end } = sp;
        sp.free();
        const original = p.text.slice(start, end);
        const kind = lint.lint_kind();
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
        out.push({
          id: `${p.id}:${start}:${end}:${kind}`,
          paraId: p.id,
          span: { start, end },
          original,
          replacements,
          kind,
          message: lint.message(),
          source: 'rules',
        });
      } finally {
        lint.free();
      }
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
  // Indian-English vocabulary is real vocabulary for Indian writers in every variant; so are tech words.
  const known: string[] = [...EN_IN_WORDS, ...TECH_WORDS, ...words];
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
