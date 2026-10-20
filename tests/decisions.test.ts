/**
 * Review-budget gate (spec §10): on every reference document, the default view needs at most
 * 10 decisions per 1,500 words, and no auto-applied or accept-all edit touches a fact-locked span.
 * Writes trust/out/decisions.md (gitignored) with the per-document table for the release report.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { PresetId } from '@/engine/presets';
import { adapterFor } from '@/formats/registry';
import { acceptAllRules } from '../cli/run';
import { countWords } from '../trust/words';

const REF = path.resolve(__dirname, '../trust/reference');
const OUT = path.resolve(__dirname, '../trust/out');
interface Doc {
  file: string;
  preset: PresetId;
  format: 'md' | 'docx';
  words: number;
  errors: { safe: number; judgment: number };
  facts: string[];
}
const { docs } = JSON.parse(fs.readFileSync(path.join(REF, 'manifest.json'), 'utf8')) as { docs: Doc[] };

const BUDGET = 10;
const PER_WORDS = 1500;
const rows: string[] = [];
let linter: RulesLinter;

beforeAll(async () => {
  linter = await createLinter('American');
});

afterAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  const table = [
    '| Document | Preset | Words | Planted errors | Auto-applied | Decisions (top) | Under "more" | Per 1,500 words |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.sort(),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'decisions.md'), `# Review budget (≤${BUDGET} per ${PER_WORDS} words)\n\n${table}\n`);
});

describe('reference corpus', () => {
  it('has 5 documents per preset, at least 2 .docx each, 800-2,000 words', () => {
    for (const preset of ['academic', 'blog', 'script', 'business']) {
      const mine = docs.filter((d) => d.preset === preset);
      expect(mine).toHaveLength(5);
      expect(mine.filter((d) => d.format === 'docx').length).toBeGreaterThanOrEqual(2);
    }
    for (const d of docs) {
      expect(d.words).toBeGreaterThanOrEqual(800);
      expect(d.words).toBeLessThanOrEqual(2000);
    }
  });
});

describe('review budget', () => {
  it.each(docs.map((d) => [d.file, d] as const))(
    '%s: ≤10 decisions per 1,500 words, no auto or accept-all edit on a fact-locked span',
    async (_name, doc) => {
      const adapter = adapterFor(doc.file)!;
      const { paras } = await adapter.read(new Uint8Array(fs.readFileSync(path.join(REF, doc.file))));
      const session = await CheckSession.start(
        paras,
        { preset: doc.preset, fallbackVariant: 'American', language: adapter.language, dictionary: [] },
        { linter },
      );
      const words = countWords(paras);
      const decisions = session.decisionCount();
      const perBudget = (decisions * PER_WORDS) / words;

      const auto = session.outcomes().filter((o) => o.status === 'applied' && o.auto);
      const autoOnLocked = auto.filter((o) => session.touchesLocked(o.candidate.id)).map((o) => o.candidate.original);
      const more = session.decisions().more.length;
      acceptAllRules(session);
      const acceptedOnLocked = session
        .outcomes()
        .filter((o) => o.status === 'applied' && session.touchesLocked(o.candidate.id))
        .map((o) => o.candidate.original);

      const planted = doc.errors.safe + doc.errors.judgment;
      rows.push(`| \`${doc.file}\` | ${doc.preset} | ${words} | ${planted} | ${auto.length} | ${decisions} | ${more} | ${perBudget.toFixed(1)} |`);

      expect(words).toBe(doc.words);
      expect(perBudget).toBeLessThanOrEqual(BUDGET);
      expect(autoOnLocked).toEqual([]);
      expect(acceptedOnLocked).toEqual([]);
    },
    30_000,
  );
});
