import fs from 'node:fs';
import path from 'node:path';
import { CheckSession, type CheckOptions } from '../src/engine/session';
import { exportReport } from '../src/engine/report';
import { DEFAULT_MODULES } from '../src/engine/modules';
import { createScriptEngines } from '../src/engine/scriptEngines';
import { PRESETS, type PresetId } from '../src/engine/presets';
import type { Variant } from '../src/engine/types';
import { variantForLocale } from '../src/engine/localeVariant';
import { adapterFor } from '../src/formats/registry';
import type { SaveMode } from '../src/formats/types';

const VARIANTS: Variant[] = ['American', 'British', 'Australian', 'Canadian', 'Indian'];

/** Node's locale is the Windows regional format ("en-IN"); the app asks Windows for the same (os_locale). */
function localeVariant(): Variant {
  return variantForLocale(Intl.DateTimeFormat().resolvedOptions().locale);
}

interface Args {
  input: string;
  output: string;
  preset: PresetId;
  mode: SaveMode;
  variant?: Variant;
  acceptAll: boolean;
  report?: string;
}

function parseArgs(argv: string[]): Args {
  const pos: string[] = [];
  const a: Args = { input: '', output: '', preset: 'blog', mode: 'tracked', acceptAll: false };
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--preset') {
      const v = value(i++, t);
      if (!(v in PRESETS)) throw new Error(`unknown preset: ${v}`);
      a.preset = v as PresetId;
    } else if (t === '--mode') {
      const v = value(i++, t);
      if (v !== 'tracked' && v !== 'clean') throw new Error(`unknown mode: ${v}`);
      a.mode = v;
    } else if (t === '--variant') {
      const v = value(i++, t);
      if (!VARIANTS.includes(v as Variant)) throw new Error(`unknown variant: ${v}`);
      a.variant = v as Variant;
    } else if (t === '--report') a.report = value(i++, t);
    else if (t === '--accept-all-rules') a.acceptAll = true;
    else if (t.startsWith('--')) throw new Error(`unknown option: ${t}`);
    else pos.push(t);
  }
  if (pos.length !== 2) {
    throw new Error(
      'usage: check-file <in> <out> [--preset blog] [--mode tracked|clean] [--variant V] [--accept-all-rules] [--report out.md]',
    );
  }
  [a.input, a.output] = pos;
  return a;
}

function sameFile(a: string, b: string): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/**
 * Models the maximum opt-in (spec §5): accept every pending decision except LLM output,
 * tracked-change-locked and fact-locked candidates, and candidates offering a choice (more than
 * one replacement: a user cannot "accept all" a choice). Batches are accepted member by member.
 */
export function acceptAllRules(session: CheckSession): void {
  const byId = new Map(session.candidates().map((c) => [c.id, c]));
  const isPending = (id: string) => session.outcomes().find((o) => o.candidate.id === id)?.status === 'pending';
  const tried = new Set<string>();
  for (;;) {
    const { top, more } = session.decisions();
    const next = [...top, ...more].find((d) => !tried.has(d.id));
    if (!next) return;
    tried.add(next.id);
    // The names, terms and Indian-language cards are answered with their own methods, never by replacing a word.
    if (next.kind !== 'single' && next.kind !== 'batch') continue;
    for (const id of next.candidateIds) {
      const c = byId.get(id)!;
      if (c.source === 'llm' || c.replacements.length !== 1 || session.touchesLocked(id)) continue;
      // An earlier accept may have decided this member (e.g. superseded it); accept() would throw.
      if (next.candidateIds.length > 1 && !isPending(id)) continue;
      session.accept(id, 0);
    }
  }
}

export async function run(argv: string[]): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (sameFile(args.input, args.output)) throw new Error('output must differ from input');
    const adapter = adapterFor(args.input);
    if (!adapter) throw new Error(`unsupported file type: ${path.extname(args.input) || args.input}`);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(fs.readFileSync(args.input));
    } catch (e) {
      throw new Error(`cannot read ${args.input}: ${(e as Error).message}`);
    }
    const { paras, handle } = await adapter.read(bytes);
    const opts: CheckOptions = {
      preset: args.preset,
      variant: args.variant,
      fallbackVariant: localeVariant(),
      language: adapter.language,
      dictionary: [],
      // The CLI (and so the trust suite) always checks with the default modules.
      modules: DEFAULT_MODULES,
    };
    const session = await CheckSession.start(paras, opts, { scriptEngines: createScriptEngines() });
    const safe = session.outcomes().filter((o) => o.status === 'applied' && o.auto).length;
    const decisions = session.decisionCount();
    if (args.acceptAll) acceptAllRules(session);

    const edits = session.acceptedEdits();
    const { bytes: out, unplaceable } = await adapter.write(handle, edits, args.mode);
    for (const u of unplaceable) {
      const c = session
        .candidates()
        .find((x) => x.paraId === u.edit.paraId && x.span.start === u.edit.span.start && x.span.end === u.edit.span.end);
      if (c) session.markUnplaceable(c.id, u.reason);
    }
    fs.writeFileSync(args.output, out);
    if (args.report) fs.writeFileSync(args.report, exportReport(session, path.basename(args.input)));
    console.log(
      JSON.stringify({
        variant: session.variant,
        mixedVariant: session.mixedVariant,
        safe,
        decisions,
        unplaceable: unplaceable.length,
      }),
    );
    return 0;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}
