/**
 * Owner decision 2026-10-25 (Task F5, F4 re-review 3 I-4): a kind the user adds in Settings joins the simple-fixes
 * card unticked. Harper's WordChoice, Grammar and Style fixes are often wrong on real text ("return too normal",
 * "affects such as", "how to people"), so on the trust documents "Review and apply all" with the default ticks
 * applies nothing more with every kind on than with the default settings.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CheckSession } from '@/engine/session';
import { SIMPLE_FIXES_ID } from '@/engine/decisions';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import type { PresetId } from '@/engine/presets';
import type { Tier } from '@/engine/types';
import { adapterFor } from '@/formats/registry';
import { AUTO_APPLY_KINDS } from '@/ui/state/settings';

const REFERENCE = path.resolve(__dirname, '../trust/reference');
const EVERYTHING_ON: Partial<Record<string, Tier>> = Object.fromEntries(AUTO_APPLY_KINDS.map((k) => [k, 'safe']));

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const documents = (['academic', 'blog', 'business', 'script'] as PresetId[]).flatMap((preset) =>
  fs.readdirSync(path.join(REFERENCE, preset)).sort().map((file) => [preset, file] as const),
);

/** Each change "Review and apply all" makes with the card's default ticks: `¶id "original" → "replacement"`. */
async function defaultApplyAll(preset: PresetId, file: string, tierOverrides?: Partial<Record<string, Tier>>): Promise<string[]> {
  const adapter = adapterFor(file)!;
  const { paras } = await adapter.read(new Uint8Array(fs.readFileSync(path.join(REFERENCE, preset, file))));
  const s = await CheckSession.start(
    paras,
    { preset, fallbackVariant: 'Indian', language: adapter.language, dictionary: [], modules: DEFAULT_MODULES, tierOverrides },
    { linter },
  );
  const { top, more } = s.decisions();
  const card = [...top, ...more].find((d) => d.id === SIMPLE_FIXES_ID);
  const unticked = new Set(card?.startUnticked ?? []);
  const ticked = (card?.candidateIds ?? []).filter((id) => !unticked.has(id));
  if (ticked.length) s.applyBatch(SIMPLE_FIXES_ID, ticked);
  return s
    .outcomes()
    .filter((o) => o.batch !== undefined)
    .map((o) => `¶${o.candidate.paraId} "${o.candidate.original}" → "${o.replacement}"`);
}

describe('kinds added in Settings join the simple-fixes card unticked (Task F5)', () => {
  it('has the trust documents', () => {
    expect(documents).toHaveLength(22);
  });

  it.each(documents)('%s/%s: every kind on adds no ticked fix', async (preset, file) => {
    const usual = new Set(await defaultApplyAll(preset, file));
    const everyKind = await defaultApplyAll(preset, file, EVERYTHING_ON);
    expect(everyKind.filter((change) => !usual.has(change))).toEqual([]);
  });
});
