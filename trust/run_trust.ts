/**
 * `npm run trust`: the release gate (spec section 9).
 *
 * 1. Regenerates trust/corpus/ with make_corpus.py.
 * 2. Runs the CLI with --accept-all-rules on every corpus file and every reference doc,
 *    in both save modes, into trust/out/<mode>/{corpus,reference}/, with the network blocked.
 * 3. Fact-lock gate (in process): no auto-applied or accept-all edit overlaps a fact-locked span.
 * 4. Runs analyze.py per mode (facts, invisible characters, LaTeX/code spans, docx skeleton/parts).
 * 5. Negative control: damaged copies of the outputs must fail each gate.
 * Exits non-zero when anything fails.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CheckSession } from '../src/engine/session';
import { DEFAULT_MODULES } from '../src/engine/modules';
import type { PresetId } from '../src/engine/presets';
import { adapterFor } from '../src/formats/registry';
import { acceptAllRules } from '../cli/run';
import JSZip from 'jszip';

const TRUST = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(TRUST);
const CORPUS = path.join(TRUST, 'corpus');
const REFERENCE = path.join(TRUST, 'reference');
const OUT = path.join(TRUST, 'out');
const MODES = ['tracked', 'clean'] as const;
/** Corpus files run under the academic preset: it accepts the most edit kinds. */
const CORPUS_PRESET: PresetId = 'academic';

interface Job {
  /** Path under trust/out/<mode>/. */
  rel: string;
  input: string;
  preset: PresetId;
}

const failures: string[] = [];
const fail = (msg: string) => {
  failures.push(msg);
  console.log(`  FAIL ${msg}`);
};

/** UTF-8 stdio for Python children regardless of the console code page. */
const PY_ENV = { ...process.env, PYTHONUTF8: '1' };

function python(args: string[]): number {
  // `python` may be a .bat shim (pyenv-win): needs a shell on Windows.
  const r = spawnSync('python', args.map((a) => `"${a}"`), { cwd: REPO, stdio: 'inherit', shell: true, env: PY_ENV });
  return r.status ?? 1;
}

/** Exit code block_network.cjs forces when any network attempt happened, even a caught one. */
const EXIT_NETWORK = 99;
let markerSeq = 0;

/** Env that preloads the network blocker, and the marker file it writes on any attempt. */
function blockedEnv(): { env: NodeJS.ProcessEnv; marker: string } {
  // NODE_OPTIONS treats backslashes inside quotes as escapes: use forward slashes.
  const block = path.join(TRUST, 'block_network.cjs').replace(/\\/g, '/');
  const dir = path.join(OUT, 'net');
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, `run-${process.pid}-${markerSeq++}.log`);
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require "${block}"`.trim(),
    TRUST_NET_MARKER: marker,
  };
  return { env, marker };
}

/** What a blocked run attempted, or null. Fails closed: exit 99 or a marker file both count. */
function networkAttempt(code: number, marker: string): string | null {
  const logged = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
  if (logged) return logged.split('\n').join('; ');
  return code === EXIT_NETWORK ? `exit code ${EXIT_NETWORK}` : null;
}

function jobs(): Job[] {
  const out: Job[] = fs
    .readdirSync(CORPUS)
    .filter((n) => adapterFor(n))
    .sort()
    .map((n) => ({ rel: `corpus/${n}`, input: path.join(CORPUS, n), preset: CORPUS_PRESET }));
  const manifest = JSON.parse(fs.readFileSync(path.join(REFERENCE, 'manifest.json'), 'utf8')) as {
    docs: { file: string; preset: PresetId }[];
  };
  for (const d of manifest.docs) out.push({ rel: `reference/${d.file}`, input: path.join(REFERENCE, d.file), preset: d.preset });
  return out;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  /** What the run tried to reach on the network, or null. */
  network: string | null;
}

function spawnBlocked(args: string[]): Promise<Run> {
  const { env, marker } = blockedEnv();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: REPO, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (c) => {
      const code = c ?? 1;
      resolve({ code, stdout, stderr, network: networkAttempt(code, marker) });
    });
  });
}

async function runCli(job: Job, mode: string): Promise<Run & { job: Job; mode: string }> {
  const output = path.join(OUT, mode, job.rel);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const args = ['--import', 'tsx', path.join(REPO, 'cli', 'check-file.ts'), job.input, output, '--preset', job.preset, '--mode', mode, '--accept-all-rules'];
  return { job, mode, ...(await spawnBlocked(args)) };
}

/**
 * Network negative control: a child that makes blocked calls, catches every error and exits 0
 * must still be marked as a network attempt (fail closed), for CommonJS and ESM imports alike.
 */
async function networkNegativeControl(): Promise<void> {
  const probe = [
    "import http from 'node:http';",
    "import dns from 'node:dns';",
    "import net from 'node:net';",
    "try { net.connect(80, 'example.com').on('error', () => {}); } catch {}",
    "try { http.get('http://example.com'); } catch {}",
    "try { await dns.promises.lookup('example.com'); } catch {}",
    "try { await fetch('https://example.com'); } catch {}",
    'process.exit(0);',
  ].join('\n');
  const r = await spawnBlocked(['--input-type=module', '-e', probe]);
  const ok = r.network !== null && r.code === EXIT_NETWORK;
  console.log(`  ${ok ? 'caught' : 'MISSED'}: caught-and-ignored network calls (exit ${r.code}; ${r.network ?? 'no marker'})`);
  if (!ok) fail('negative control: a run that swallowed a blocked network call was not marked failed');
  for (const want of ['http', 'dns.promises.lookup', 'fetch', 'net']) {
    if (!r.network?.includes(want)) fail(`negative control: ${want} attempt was not recorded`);
  }
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

/** Gate: no auto-applied edit, and no accept-all edit, overlaps a fact-locked span. */
async function factLockGate(job: Job): Promise<string> {
  const adapter = adapterFor(job.input)!;
  const { paras } = await adapter.read(new Uint8Array(fs.readFileSync(job.input)));
  const session = await CheckSession.start(paras, {
    preset: job.preset,
    fallbackVariant: 'American',
    language: adapter.language,
    dictionary: [],
    depth: 'standard', // the trust suite always measures the default depth
    modules: DEFAULT_MODULES, // and the default modules
  });
  if (JSON.stringify(session.modules) !== JSON.stringify(DEFAULT_MODULES)) {
    fail(`modules ${job.rel}: the trust suite must run with the default modules, got ${JSON.stringify(session.modules)}`);
  }
  const auto = session.outcomes().filter((o) => o.status === 'applied' && o.auto);
  const badAuto = auto.filter((o) => session.touchesLocked(o.candidate.id));
  acceptAllRules(session);
  const applied = session.outcomes().filter((o) => o.status === 'applied');
  const badAll = applied.filter((o) => session.touchesLocked(o.candidate.id));
  for (const o of [...badAuto, ...badAll]) {
    fail(`fact-lock ${job.rel}: edit "${o.candidate.original}" -> "${o.replacement}" overlaps a fact-locked span`);
  }
  return `${job.rel}: ${auto.length} auto, ${applied.length} after accept-all, ${badAuto.length + badAll.length} on locked spans`;
}

/**
 * Negative control: damage a copy of the tracked outputs once per gate and require analyze.py to
 * report each gate as failed. A gate that cannot fail proves nothing.
 */
async function negativeControl(): Promise<void> {
  const src = path.join(OUT, 'tracked');
  const dst = path.join(OUT, 'damaged');
  fs.cpSync(src, dst, { recursive: true });
  const edit = (rel: string, from: string | RegExp, to: string) => {
    const p = path.join(dst, rel);
    const s = fs.readFileSync(p, 'utf8');
    const t = s.replace(from, to);
    if (t === s) throw new Error(`negative control: nothing to damage in ${rel}`);
    fs.writeFileSync(p, t);
  };
  edit('corpus/prose.txt', '1,284', '1,248'); // facts
  edit('corpus/paper.txt', 'Pune', 'Pu​ne'); // invisible (and facts)
  edit('corpus/paper.md', '$\\alpha = 0.05$', '$\\alpha = 0.5$'); // spans
  const docx = path.join(dst, 'corpus/report.docx');
  const zip = await JSZip.loadAsync(fs.readFileSync(docx));
  const doc = await zip.file('word/document.xml')!.async('string');
  zip.file('word/document.xml', doc.replace('<w:b/>', '')); // docx skeleton (bold lost)
  const hdr = await zip.file('word/header1.xml')!.async('string');
  zip.file('word/header1.xml', hdr.replace('must survive', 'was edited')); // docx parts
  fs.writeFileSync(docx, await zip.generateAsync({ type: 'uint8array' }));

  const r = spawnSync('python', [`"${path.join(TRUST, 'analyze.py')}"`, '--outputs', `"${dst}"`], { cwd: REPO, shell: true, encoding: 'utf8', env: PY_ENV });
  const out = r.stdout ?? '';
  const expected: [string, string][] = [
    ['corpus/prose.txt', 'facts'],
    ['corpus/paper.txt', 'invisible'],
    ['corpus/paper.md', 'spans'],
    ['corpus/report.docx', 'docx skeleton'],
    ['corpus/report.docx', 'docx parts'],
  ];
  const sections = out.split(/^## /m);
  for (const [file, gateName] of expected) {
    const sec = sections.find((s) => s.startsWith(file)) ?? '';
    const caught = sec.includes(`[FAIL] ${gateName}:`);
    console.log(`  ${caught ? 'caught' : 'MISSED'}: ${gateName} damage in ${file}`);
    if (!caught) fail(`negative control: analyze.py did not catch ${gateName} damage in ${file}`);
  }
  if (r.status === 0) fail('negative control: analyze.py exited 0 on damaged outputs');
  fs.rmSync(dst, { recursive: true, force: true });
}

async function main(): Promise<void> {
  console.log('# 1. corpus');
  if (python([path.join(TRUST, 'make_corpus.py')]) !== 0) fail('make_corpus.py failed');

  const all = jobs();
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`\n# 2. CLI runs (${all.length} inputs x ${MODES.length} modes, network blocked)`);
  const runs = await pool(
    MODES.flatMap((m) => all.map((j) => [j, m] as const)),
    Math.max(2, Math.min(6, os.cpus().length - 1)),
    ([j, m]) => runCli(j, m),
  );
  for (const r of runs) {
    if (r.network) fail(`network ${r.mode} ${r.job.rel}: ${r.network}`);
    if (r.code !== 0) fail(`cli ${r.mode} ${r.job.rel}: exit ${r.code}: ${r.stderr.trim().split('\n').slice(-3).join(' | ')}`);
    else if (r.mode === 'tracked') console.log(`  ${r.job.rel} [${r.job.preset}] ${r.stdout.trim()}`);
  }

  console.log('\n# 3. fact-lock gate');
  for (const j of all) console.log(`  ${await factLockGate(j)}`);

  for (const m of MODES) {
    console.log(`\n# 4. analyze.py (${m})`);
    if (python([path.join(TRUST, 'analyze.py'), '--outputs', path.join(OUT, m)]) !== 0) fail(`analyze.py ${m}: gates failed`);
  }

  console.log('\n# 5. negative control (every gate must catch planted damage)');
  await negativeControl();
  await networkNegativeControl();

  console.log(failures.length ? `\nTRUST SUITE FAILED (${failures.length}):\n- ${failures.join('\n- ')}` : '\nTRUST SUITE PASSED');
  process.exit(failures.length ? 1 : 0);
}

await main();
