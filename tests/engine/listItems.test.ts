/**
 * Never-damage regressions from the owner's testing (Task U3, items 4b and 4c): list labels and list items
 * are not sentence starts, and acronyms are never lowercased. Fixture lines are from the owner's sample.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { tierOf, type TierContext } from '@/engine/tiers';
import { PRESETS } from '@/engine/presets';
import type { Candidate, Paragraph } from '@/engine/types';
import { plaintextAdapter } from '@/formats/text';
import { docxAdapter } from '@/formats/docx';
import { buildDocx } from '../fixtures/make_docx';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const start = (paras: Paragraph[]) =>
  CheckSession.start(paras, { preset: 'business', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] }, { linter });

/** Capitalization flags that are auto-applied or shown for review (anything not hidden). */
function visibleCapitalisation(s: CheckSession): Candidate[] {
  return s.candidates().filter((c) => c.kind === 'Capitalization' && s.tier(c.id) !== 'hidden');
}

const OWNER_LIST = [
  'Confidential Information does not include information that:',
  '',
  'a. is publicly available without breach of this Agreement;',
  '',
  'b. was already lawfully known by the Freelancer before disclosure;',
  '',
  'Internal documentation, processes, SOPs, and training materials',
].join('\n');

describe('list labels are never capitalised (4b)', () => {
  it("the owner's lettered list: nothing is auto-applied and nothing is flagged", async () => {
    const { paras } = await plaintextAdapter.read(new TextEncoder().encode(OWNER_LIST));
    const s = await start(paras);
    expect(visibleCapitalisation(s).map((c) => c.original)).toEqual([]);
    expect(s.outcomes().filter((o) => o.auto)).toEqual([]);
  });

  it.each([
    'a. is publicly available.',
    'a. is publicly available without breach of this Agreement;',
    'b) was already known;',
    'i. was lawfully obtained from a third party.',
    'ii. is public;',
    '(iv) is independently developed by the Freelancer; or',
    '1. is public;',
    'A. is publicly available without breach of this Agreement;',
    '(c) was lawfully obtained from a third party.',
  ])('"%s": the label and the word after it are left alone', async (text) => {
    const s = await start([{ id: 0, text }]);
    const visible = s.candidates().filter((c) => s.tier(c.id) !== 'hidden');
    expect(visible.map((c) => `${c.kind}: ${c.original} → ${c.replacements[0]}`)).toEqual([]);
  });

  it('a label at the start of a later line of the same paragraph counts too', async () => {
    const s = await start([{ id: 0, text: 'The terms:\na. is public;\nb. was known.' }]);
    expect(s.candidates().filter((c) => s.tier(c.id) !== 'hidden')).toEqual([]);
  });

  it('a flag that only starts at the label (a long-sentence warning) is still shown', () => {
    const text = 'viii) a statement of the boards, councils, committees and other bodies consisting of two or more persons;';
    const c: Candidate = {
      id: 'long',
      paraId: 0,
      span: { start: 0, end: text.length },
      original: text,
      replacements: [],
      kind: 'Readability',
      message: 'This sentence is 42 words long.',
      source: 'rules',
    };
    const ctx: TierContext = { locked: new Map(), variantWords: new Set(), preset: PRESETS.business, paraText: new Map([[0, text]]) };
    expect(tierOf(c, ctx)).toBe('review');
  });

  it('a real sentence start is still capitalised', async () => {
    const s = await start([{ id: 0, text: 'We left early. the bus was late.' }]);
    const the = s.candidates().find((c) => c.original === 'the')!;
    expect(the.kind).toBe('Capitalization');
    expect(s.tier(the.id)).toBe('safe');
  });
});

/** A Word list item: Word draws the "a." itself, so the paragraph text starts with the lowercase continuation. */
const listPara = (text: string, numId = '1') =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const plainPara = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe('Word list items are not sentence starts (4b)', () => {
  it('the reader marks paragraphs with w:numPr as list items (numId 0 switches numbering off)', async () => {
    const bytes = await buildDocx(listPara('is public;') + listPara('was known;', '0') + plainPara('Plain text.'));
    const { paras } = await docxAdapter.read(bytes);
    expect(paras.map((p) => p.listItem ?? false)).toEqual([true, false, false]);
  });

  it('"is" and "was" at the start of list items are never capitalised; a plain paragraph still is', async () => {
    const bytes = await buildDocx(
      listPara('is publicly available without breach of this Agreement;') +
        listPara('was already lawfully known by the Freelancer before disclosure;') +
        listPara('is independently developed by the Freelancer; or') +
        plainPara('the report was late. we fixed it.'),
    );
    const { paras } = await docxAdapter.read(bytes);
    const s = await start(paras);
    expect(visibleCapitalisation(s).map((c) => [c.paraId, c.original])).toEqual([
      [3, 'the'],
      [3, 'we'],
    ]);
  });
});

describe('acronyms and mixed-case tokens are never lowercased (4c)', () => {
  it('"SOPs → sops" from the owner\'s document is not offered', async () => {
    const s = await start([{ id: 0, text: 'Internal documentation, processes, SOPs, and training materials' }]);
    const lowered = s.candidates().filter((c) => c.original === 'SOPs' && s.tier(c.id) !== 'hidden');
    expect(lowered).toEqual([]);
  });

  const ctx: TierContext = { locked: new Map(), variantWords: new Set(), preset: PRESETS.business };
  const capital = (original: string, replacement: string): Candidate => ({
    id: original,
    paraId: 0,
    span: { start: 10, end: 10 + original.length },
    original,
    replacements: [replacement],
    kind: 'Capitalization',
    message: `The canonical dictionary spelling is \`${replacement}\`.`,
    source: 'rules',
  });

  it.each([
    ['SOPs', 'sops'],
    ['APIs', 'apis'],
    ['KPIs', 'kpis'],
    ['NASA', 'nasa'],
    ['UPI', 'Upi'],
  ])('%s → %s is hidden', (original, replacement) => {
    expect(tierOf(capital(original, replacement), ctx)).toBe('hidden');
  });

  it('a caps-lock slip ("THe" → "The") is still fixed', () => {
    expect(tierOf(capital('THe', 'The'), ctx)).toBe('safe');
  });
});
