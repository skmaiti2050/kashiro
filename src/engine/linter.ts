import { Dialect, LocalLinter, SuggestionKind } from 'harper.js';
import type { BinaryModule } from 'harper.js';
import type { Candidate, Paragraph, Variant } from './types';

export interface RulesLinter {
  lintParagraphs(paras: Paragraph[], language: 'plaintext' | 'markdown'): Promise<Candidate[]>;
  addWords(words: string[]): Promise<void>;
  setVariant(v: Variant): Promise<void>;
}

/**
 * `opts.binary` lets the UI pass `harper.js/binary` (separate .wasm asset).
 * Default is `harper.js/binaryInlined`, loaded lazily so the 25 MB file never
 * enters the static import graph of the engine.
 */
export async function createLinter(
  variant: Variant,
  words: string[] = [],
  opts: { binary?: BinaryModule } = {},
): Promise<RulesLinter> {
  const binary = opts.binary ?? (await import('harper.js/binaryInlined')).binaryInlined;
  const linter = new LocalLinter({ binary, dialect: Dialect[variant] });
  await linter.setup();
  if (words.length) await linter.importWords(words);

  return {
    async lintParagraphs(paras, language) {
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
    },
    async addWords(w) {
      await linter.importWords(w);
    },
    async setVariant(v) {
      await linter.setDialect(Dialect[v]);
    },
  };
}
