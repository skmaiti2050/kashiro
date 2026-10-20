/**
 * Review-budget gate (spec §10, made stricter): on every reference document, ALL ranked pending
 * decisions (top and "more", excluding only tracked-change-locked ones) scaled to 1,500 words must be
 * ≤ 10, so a long tail cannot pass by being capped out of the default view. Also:
 *   - no auto-applied or accept-all edit touches a fact-locked span;
 *   - recall: no planted error the engine detects is hidden. A planted safe error must be auto-applied
 *     or ranked; a planted judgment error must be ranked (never auto-applied, never dropped).
 * Writes trust/out/decisions.md (gitignored) with the per-document table for the release report.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { PresetId } from '@/engine/presets';
import type { Candidate } from '@/engine/types';
import { adapterFor } from '@/formats/registry';
import { acceptAllRules } from '../cli/run';
import { countWords } from '../trust/words';
import type { Answer } from '../trust/build_reference';

const REF = path.resolve(__dirname, '../trust/reference');
const OUT = path.resolve(__dirname, '../trust/out');
interface Doc {
  file: string;
  preset: PresetId;
  format: 'md' | 'docx';
  words: number;
  errors: { safe: number; judgment: number };
  answers: Answer[];
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
    '| Document | Preset | Words | Planted (s/j) | Auto-applied | Top | Ranked | of which names / unknown words | Ranked per 1,500 | Safe found (auto/ranked) | Judgment found (ranked) | Planted, not detected |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.sort(),
  ].join('\n');
  fs.writeFileSync(
    path.join(OUT, 'decisions.md'),
    `# Review budget: all ranked decisions ≤${BUDGET} per ${PER_WORDS} words\n\n${table}\n`,
  );
});

const overlaps = (c: Candidate, a: Answer) =>
  c.paraId === a.at.para && c.span.start < a.at.end && a.at.start < c.span.end;

describe('reference corpus', () => {
  it('has at least 5 documents per preset, at least 2 .docx each, 800-2,000 words', () => {
    for (const preset of ['academic', 'blog', 'script', 'business']) {
      const mine = docs.filter((d) => d.preset === preset);
      expect(mine.length).toBeGreaterThanOrEqual(5);
      expect(mine.filter((d) => d.format === 'docx').length).toBeGreaterThanOrEqual(2);
    }
    for (const d of docs) {
      expect(d.words).toBeGreaterThanOrEqual(800);
      expect(d.words).toBeLessThanOrEqual(2000);
    }
  });
});

describe('review budget and recall', () => {
  it.each(docs.map((d) => [d.file, d] as const))(
    '%s',
    async (_name, doc) => {
      const adapter = adapterFor(doc.file)!;
      const { paras } = await adapter.read(new Uint8Array(fs.readFileSync(path.join(REF, doc.file))));
      const session = await CheckSession.start(
        paras,
        { preset: doc.preset, fallbackVariant: 'American', language: adapter.language, dictionary: [] },
        { linter },
      );
      const words = countWords(paras);
      const top = session.decisionCount();
      const ranked = session.rankedDecisionCount();
      const perBudget = (ranked * PER_WORDS) / words;

      // Recall, before anything is accepted.
      const { top: topD, more } = session.decisions();
      const rankedIds = new Set([...topD, ...more].flatMap((d) => d.candidateIds));
      const byId = new Map(session.candidates().map((c) => [c.id, c]));
      const rankedFirst = [...topD, ...more].map((d) => byId.get(d.candidateIds[0])!);
      const isWord = (c: Candidate) => c.kind === 'Spelling' || c.kind === 'Typo';
      const names = rankedFirst.filter((c) => isWord(c) && /^\p{Lu}/u.test(c.original)).length;
      const unknownWords = rankedFirst.filter((c) => isWord(c) && !/^\p{Lu}/u.test(c.original)).length;
      const outcomes = session.outcomes();
      const autoIds = new Set(outcomes.filter((o) => o.status === 'applied' && o.auto).map((o) => o.candidate.id));
      const all = session.candidates();
      const safeFound = { auto: 0, ranked: 0 };
      let judgmentFound = 0;
      const undetected: string[] = [];
      const hidden: string[] = [];
      const judgmentAuto: string[] = [];
      for (const a of doc.answers) {
        const hits = all.filter((c) => overlaps(c, a));
        if (hits.length === 0) {
          undetected.push(`${a.type}:${a.wrong}`);
          continue;
        }
        const isAuto = hits.some((c) => autoIds.has(c.id));
        const isRanked = hits.some((c) => rankedIds.has(c.id));
        if (a.type === 's') {
          if (isAuto) safeFound.auto++;
          else if (isRanked) safeFound.ranked++;
          else hidden.push(`s:${a.wrong}`);
        } else {
          if (isRanked) judgmentFound++;
          else if (isAuto) judgmentAuto.push(a.wrong);
          else hidden.push(`j:${a.wrong}`);
        }
      }

      const auto = outcomes.filter((o) => o.status === 'applied' && o.auto);
      const autoOnLocked = auto.filter((o) => session.touchesLocked(o.candidate.id)).map((o) => o.candidate.original);
      acceptAllRules(session);
      const acceptedOnLocked = session
        .outcomes()
        .filter((o) => o.status === 'applied' && session.touchesLocked(o.candidate.id))
        .map((o) => o.candidate.original);

      rows.push(
        `| \`${doc.file}\` | ${doc.preset} | ${words} | ${doc.errors.safe}/${doc.errors.judgment} | ${auto.length} | ${top} | ${ranked} | ${names} / ${unknownWords} | ${perBudget.toFixed(1)} | ${safeFound.auto}/${safeFound.ranked} | ${judgmentFound} | ${undetected.length ? undetected.join(', ') : '-'} |`,
      );

      expect(words).toBe(doc.words);
      expect({ hidden, judgmentAuto }).toEqual({ hidden: [], judgmentAuto: [] });
      expect(autoOnLocked).toEqual([]);
      expect(acceptedOnLocked).toEqual([]);
      expect(perBudget).toBeLessThanOrEqual(BUDGET);
    },
    30_000,
  );
});
