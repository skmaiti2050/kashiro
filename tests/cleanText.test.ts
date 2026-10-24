/**
 * Clean-text precision gate (review #4, Task F3): correct prose with legitimate doublings ("had had", "that
 * that", "What it is is", "log in in the morning"), names, Indian English, list labels, acronyms, amounts,
 * URLs and code (trust/clean/). Under every preset, nothing is changed without asking, and only a few
 * decisions are offered, so the engine can't pass the recall floor by flagging everything.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import { PRESETS, type PresetId } from '@/engine/presets';
import { adapterFor } from '@/formats/registry';

const CLEAN = path.resolve(__dirname, '../trust/clean');
/** The most ranked decisions a clean document of ~300 words may get: measured 4, 2 and 4 in Task F3. */
const MAX_DECISIONS = 4;

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const files = fs.readdirSync(CLEAN).sort();
const presets = Object.keys(PRESETS) as PresetId[];

describe('clean text: no automatic change, few decisions', () => {
  it('has the clean documents', () => {
    expect(files).toEqual(['office-memo.txt', 'research-summary.md', 'weekend-notes.md']);
  });

  it.each(files.flatMap((file) => presets.map((preset) => [file, preset] as const)))('%s (%s)', async (file, preset) => {
    const adapter = adapterFor(file)!;
    const { paras } = await adapter.read(new Uint8Array(fs.readFileSync(path.join(CLEAN, file))));
    const session = await CheckSession.start(
      paras,
      { preset, fallbackVariant: 'Indian', language: adapter.language, dictionary: [], modules: DEFAULT_MODULES },
      { linter },
    );
    const auto = session.outcomes().filter((o) => o.status === 'applied' && o.auto);
    expect(auto.map((o) => `${o.candidate.kind}: ${o.candidate.original} → ${o.replacement}`)).toEqual([]);
    expect(session.rankedDecisionCount()).toBeLessThanOrEqual(MAX_DECISIONS);
  });
});
