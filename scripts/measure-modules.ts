/**
 * Ranked decisions and auto-fixes on the trust reference documents with each optional module switched off
 * (task U2), at the default depth, to show what "off" gives compared with the defaults.
 *
 * Usage: npx tsx scripts/measure-modules.ts
 * Prints a Markdown table of sums over all documents, then ranked/auto per document.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CheckSession } from '../src/engine/session';
import { createLinter } from '../src/engine/linter';
import { DEFAULT_MODULES, type ModuleSwitches } from '../src/engine/modules';
import type { PresetId } from '../src/engine/presets';
import { adapterFor } from '../src/formats/registry';

const REFERENCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../trust/reference');
const CARD_KINDS = new Set(['names', 'terms', 'otherLanguage']);

const VARIANTS: [string, Partial<ModuleSwitches>][] = [
  ['defaults', {}],
  ['namesCard off', { namesCard: false }],
  ['termsCard off', { termsCard: false }],
  ['otherLanguageCard off', { otherLanguageCard: false }],
  ['betterSuggestions off', { betterSuggestions: false }],
  ['all four off', { namesCard: false, termsCard: false, otherLanguageCard: false, betterSuggestions: false }],
];

interface Measure {
  ranked: number;
  auto: number;
  cards: number;
}

async function measure(file: string, preset: PresetId, modules: Partial<ModuleSwitches>, linter: Awaited<ReturnType<typeof createLinter>>): Promise<Measure> {
  const adapter = adapterFor(file)!;
  const { paras } = await adapter.read(new Uint8Array(fs.readFileSync(path.join(REFERENCE, file))));
  const session = await CheckSession.start(
    paras,
    { preset, fallbackVariant: 'American', language: adapter.language, dictionary: [], depth: 'standard', modules: { ...DEFAULT_MODULES, ...modules } },
    { linter },
  );
  const { top, more } = session.decisions();
  return {
    ranked: session.rankedDecisionCount(),
    auto: session.outcomes().filter((o) => o.auto && o.status === 'applied').length,
    cards: [...top, ...more].filter((d) => CARD_KINDS.has(d.kind)).length,
  };
}

const { docs } = JSON.parse(fs.readFileSync(path.join(REFERENCE, 'manifest.json'), 'utf8')) as { docs: { file: string; preset: PresetId }[] };
const linter = await createLinter('American');
const perDoc = new Map<string, string[]>();
const sums: string[] = [];
for (const [label, modules] of VARIANTS) {
  const total: Measure = { ranked: 0, auto: 0, cards: 0 };
  for (const doc of docs) {
    const m = await measure(doc.file, doc.preset, modules, linter);
    total.ranked += m.ranked;
    total.auto += m.auto;
    total.cards += m.cards;
    perDoc.set(doc.file, [...(perDoc.get(doc.file) ?? []), `${m.ranked}/${m.auto}`]);
  }
  sums.push(`| ${label} | ${total.ranked} | ${total.auto} | ${total.cards} |`);
}

console.log(`| modules | ranked (sum, ${docs.length} docs) | auto (sum) | cards |`);
console.log('|---|---|---|---|');
console.log(sums.join('\n'));
console.log(`\n| doc (ranked/auto) | ${VARIANTS.map(([label]) => label).join(' | ')} |`);
console.log(`|---|${VARIANTS.map(() => '---').join('|')}|`);
for (const [file, cells] of perDoc) console.log(`| ${file} | ${cells.join(' | ')} |`);
