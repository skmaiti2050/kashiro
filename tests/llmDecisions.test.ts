/**
 * Review budget with the LLM helper (task 13, step 5): on reference documents, after "Check how it
 * reads" with recorded helper answers (tests/fixtures/llm-rewrites.json), all ranked decisions,
 * rewrites included, stay ≤ 10 per 1,500 words; rewrites stay pending review; the guard gives the
 * recorded verdicts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { suggestRewrites, type Rewriter } from '@/engine/llm/suggest';
import type { PresetId } from '@/engine/presets';
import { upFrontRoom } from '@/engine/depth';
import { adapterFor } from '@/formats/registry';
import { countWords } from '../trust/words';

const REF = path.resolve(__dirname, '../trust/reference');
const { docs } = JSON.parse(fs.readFileSync(path.join(REF, 'manifest.json'), 'utf8')) as { docs: { file: string; preset: PresetId }[] };
interface Recorded {
  doc: string;
  text: string;
  rewrite: string;
  expect: string;
}
const { rewrites } = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/llm-rewrites.json'), 'utf8')) as { rewrites: Recorded[] };
const files = [...new Set(rewrites.map((r) => r.doc))];
/**
 * The depth test's documents: the fixture's, and three whose recorded "ok" answers left the fixture in Task F4.
 * Their former auto-fixes are now one simple-fixes decision, which fills the review room: no sentence is sent.
 */
const DEPTH_FILES = [...files, 'business/board-update-fy25.md', 'business/hybrid-work-policy.md', 'blog/freelancer-taxes.docx'];

const BUDGET = 10;
const PER_WORDS = 1500;

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

describe('review budget with recorded helper rewrites', () => {
  it.each(files)(
    '%s',
    async (file) => {
      const doc = docs.find((d) => d.file === file)!;
      const adapter = adapterFor(file)!;
      const { paras } = await adapter.read(new Uint8Array(fs.readFileSync(path.join(REF, file))));
      const session = await CheckSession.start(
        paras,
        { preset: doc.preset, fallbackVariant: 'American', language: adapter.language, dictionary: [], depth: 'standard' },
        { linter },
      );
      const recorded = rewrites.filter((r) => r.doc === file);
      const sent: string[] = [];
      const helper: Rewriter = {
        async rewrite(text) {
          sent.push(text);
          return recorded.find((r) => r.text === text)?.rewrite ?? null;
        },
      };
      const run = await suggestRewrites(session, helper, doc.preset, new AbortController().signal);

      // The fixture still matches what the engine sends.
      expect(sent).toEqual(expect.arrayContaining(recorded.map((r) => r.text)));
      const verdicts = recorded.map((r) => run.rejected.find((x) => x.text === r.text)?.reason ?? 'ok');
      expect(verdicts).toEqual(recorded.map((r) => r.expect));

      const llm = session.outcomes().filter((o) => o.candidate.source === 'llm');
      expect(llm).toHaveLength(recorded.filter((r) => r.expect === 'ok').length);
      for (const o of llm) {
        expect(o.status).toBe('pending');
        expect(session.tier(o.candidate.id)).toBe('review');
      }

      const perBudget = (session.rankedDecisionCount() * PER_WORDS) / countWords(paras);
      expect(perBudget).toBeLessThanOrEqual(BUDGET);
    },
    30_000,
  );
});

describe('"Check how it reads" at every review depth (Task 13 UI)', () => {
  const recordedHelper = (file: string): Rewriter & { sent: number } => {
    const helper = {
      sent: 0,
      async rewrite(text: string) {
        helper.sent++;
        return rewrites.find((r) => r.doc === file && r.text === text)?.rewrite ?? null;
      },
    };
    return helper;
  };

  it.each((['light', 'standard', 'thorough', 'everything'] as const).flatMap((depth) => DEPTH_FILES.map((file) => [depth, file] as const)))(
    '%s: %s stays within the depth’s decision budget with the AI suggestions added',
    async (depth, file) => {
      const doc = docs.find((d) => d.file === file)!;
      const adapter = adapterFor(file)!;
      const { paras } = await adapter.read(new Uint8Array(fs.readFileSync(path.join(REF, file))));
      const session = await CheckSession.start(
        paras,
        { preset: doc.preset, fallbackVariant: 'American', language: adapter.language, dictionary: [], depth },
        { linter },
      );
      const before = session.rankedDecisionCount();
      const helper = recordedHelper(file);
      await suggestRewrites(session, helper, doc.preset, new AbortController().signal);
      // The first run never adds past the room the depth leaves; a document already over it gets nothing sent.
      const room = upFrontRoom(depth, countWords(paras));
      expect(session.rankedDecisionCount()).toBeLessThanOrEqual(Math.max(before, room));
      // Room left (and a depth that sends): sentences go out; none at `everything` or when the review is full.
      if (depth === 'everything' || before >= room) expect(helper.sent).toBe(0);
      else expect(helper.sent).toBeGreaterThan(0);
    },
    30_000,
  );
});
