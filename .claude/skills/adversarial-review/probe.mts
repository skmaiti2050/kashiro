// Runs trap texts through the real engine and prints everything that could change the user's text:
//  - zero-click changes, plus a token check of the zero-click output
//  - every batch card, with each member marked TICKED or unticked
//  - the text after accepting each batch card with its default ticks
// Each case runs under 4 presets x {default settings, every Settings kind opted in}; identical results are grouped.
// Usage, from the repo root: npx tsx .claude/skills/adversarial-review/probe.mts <cases.json> [variant] [nameFilter]
// cases.json maps a case name to its text; a name ending in ".md" is read as Markdown.
import fs from 'node:fs';
import { CheckSession } from '../../../src/engine/session.ts';
import { createLinter } from '../../../src/engine/linter.ts';
import { DEFAULT_MODULES } from '../../../src/engine/modules.ts';
import { plaintextAdapter, markdownAdapter } from '../../../src/formats/text.ts';
import { AUTO_APPLY_KINDS } from '../../../src/ui/state/settings.ts';

const EVERY_KIND = Object.fromEntries(AUTO_APPLY_KINDS.map((k) => [k, 'safe' as const]));
const PRESETS = ['academic', 'blog', 'script', 'business'] as const;
// Invisible characters (format controls, default-ignorables), e.g. U+200D ZWJ, U+202E RLO.
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

// Escape anything a reader can't see, so every reported byte is exact.
function shown(text: string): string {
  return [...text]
    .map((ch) => {
      if (ch === '\n') return '\\n';
      if (ch === '\r') return '\\r';
      if (ch === '\t') return '\\t';
      if (ch !== ' ' && /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Zl}\p{Zp}\p{Zs}\p{Mn}]/u.test(ch))
        return `<U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`;
      return ch;
    })
    .join('');
}

// Independent of the engine: words, case and punctuation must survive a zero-click pass.
function sameTokens(before: string, after: string): boolean {
  const tokens = (t: string) => t.replace(INVISIBLE, '').split(/\s+/u).filter(Boolean);
  const a = tokens(before);
  const b = tokens(after);
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

const [casesFile, variantArg = 'Indian', nameFilter] = process.argv.slice(2);
const cases: Record<string, string> = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const variant = variantArg as 'Indian';
const linter = await createLinter(variant);

for (const [name, text] of Object.entries(cases)) {
  if (nameFilter && !new RegExp(nameFilter).test(name)) continue;
  const adapter = name.endsWith('.md') ? markdownAdapter : plaintextAdapter;
  const results = new Map<string, string[]>();

  for (const preset of PRESETS) {
    for (const everyKind of [false, true]) {
      const lines: string[] = [];
      const { paras, handle } = await adapter.read(new TextEncoder().encode(text));
      const options = { preset, fallbackVariant: variant, language: adapter.language, dictionary: [], modules: DEFAULT_MODULES, tierOverrides: everyKind ? EVERY_KIND : undefined };
      const session = await CheckSession.start(paras, options as never, { linter });

      for (const o of session.outcomes().filter((o) => o.status === 'applied' && o.auto))
        lines.push(`  ZERO-CLICK [${o.candidate.kind}] "${shown(o.candidate.original)}" -> "${shown(o.replacement ?? '')}"`);
      const zeroClick = new TextDecoder().decode((await adapter.write(handle, session.acceptedEdits(), 'clean')).bytes);
      if (!sameTokens(text, zeroClick)) lines.push(`  !!! ZERO-CLICK CHANGED A WORD: ${shown(zeroClick)}`);

      const byId = new Map(session.candidates().map((c) => [c.id, c]));
      const { top, more } = session.decisions();
      for (const card of [...top, ...more].filter((d) => d.kind === 'batch')) {
        const unticked = new Set(card.startUnticked ?? []);
        const ticked = card.candidateIds.filter((id) => !unticked.has(id));
        lines.push(`  CARD ${JSON.stringify(card.label)}`);
        for (const id of card.candidateIds) {
          const c = byId.get(id)!;
          const mark = unticked.has(id) ? '  unticked' : 'TICKED';
          lines.push(`    ${mark} [${c.kind}] "${shown(c.original)}" -> "${shown(c.replacements[0] ?? '')}"`);
        }
        if (ticked.length === 0) continue;
        session.applyBatch(card.id, ticked);
        const { bytes, unplaceable } = await adapter.write(handle, session.acceptedEdits(), 'clean');
        lines.push(`    after accepting its default ticks: ${shown(new TextDecoder().decode(bytes))}${unplaceable.length ? ` (unplaceable ${unplaceable.length})` : ''}`);
      }

      const key = lines.join('\n') || '  (nothing changes, no batch card)';
      results.set(key, [...(results.get(key) ?? []), `${preset}${everyKind ? '+every-kind' : ''}`]);
    }
  }

  console.log(`=== ${name}\n  IN: ${shown(text)}`);
  for (const [key, configs] of results) console.log(` [${configs.join(', ')}]\n${key}`);
}
