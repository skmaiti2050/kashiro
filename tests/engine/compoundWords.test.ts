/**
 * Compound-word noise (Task U3 item 4d): for Indian and British English, Harper's suggestions to split a closed
 * compound ("roadmap → road map") or to join a hyphenated prefix ("non-public → nonpublic", "co-operative →
 * cooperative") are hidden; both spellings are standard there. Real boundary errors ("atleast") stay.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { Variant } from '@/engine/types';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

/** The visible (not hidden) flags in `text` under `variant`, as "original → first replacement". */
async function visible(text: string, variant: Variant): Promise<string[]> {
  const s = await CheckSession.start([{ id: 0, text }], { preset: 'business', variant, fallbackVariant: variant, language: 'plaintext', dictionary: [] }, { linter });
  return s.candidates().filter((c) => s.tier(c.id) !== 'hidden').map((c) => `${c.original} → ${c.replacements[0]}`);
}

const OWNER = '"Confidential Information" means any non-public information disclosed by RentYap.\nProduct roadmap and unreleased features.';

describe('compound splits and prefix joins', () => {
  it.each<Variant>(['Indian', 'British'])("%s: the owner's \"roadmap\" and \"non-public\" are not flagged", async (variant) => {
    expect(await visible(OWNER, variant)).toEqual([]);
  });

  it.each<Variant>(['Indian', 'British'])('%s: "co-operative", "pre-defined" and "semi-final" are not flagged', async (variant) => {
    expect(await visible('A co-operative bank reached the semi-final with a pre-defined plan.', variant)).toEqual([]);
  });

  it('American English keeps them for review', async () => {
    expect(await visible(OWNER, 'American')).toEqual(['non-public → nonpublic', 'roadmap → road map']);
  });

  it.each<Variant>(['Indian', 'British'])('%s: a split that fixes grammar ("everyday" as an adverb) is still flagged', async (variant) => {
    expect(await visible('We walk to the market everyday.', variant)).toEqual(['everyday → every day']);
  });

  it.each<Variant>(['Indian', 'British'])('%s: real word-boundary errors are still flagged', async (variant) => {
    expect(await visible('Atleast we tried, infact we have alot of work.', variant)).toEqual(['Atleast → At least', 'infact → in fact', 'alot → a lot']);
  });
});
