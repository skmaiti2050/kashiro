/**
 * Measures the writing helper (Task 12) on the trust reference documents: starts one llama-server build
 * headless with the arguments the app shell uses (server_args in src-tauri/src/llm.rs), times the warm-up
 * sentence (timeOneSentence), runs the app's own pipeline (pickSentences → the prompt → LlmClient → the
 * meaning-drift guard) through suggestRewrites with the "Check more sentences" budget, and stops the server.
 *
 * Reports: the share of picked sentences whose rewrite passes the guard; first-token and total seconds per
 * sentence (median, p95; the warm-up sentence is reported on its own); prompt tokens reused from the cache;
 * the server's peak memory; and every sentence with its rewrite and verdict.
 *
 * Usage: npm run measure:llm -- <llama-server.exe of the cpu or vulkan build> <model.gguf> [output.json]
 * Peak memory is read with PowerShell's Get-Process, so this runs on Windows only.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CheckSession } from '../src/engine/session';
import { createLinter } from '../src/engine/linter';
import { DEFAULT_MODULES } from '../src/engine/modules';
import type { PresetId } from '../src/engine/presets';
import { timeOneSentence } from '../src/engine/llm/benchmark';
import { LlmClient } from '../src/engine/llm/client';
import { lockedTokens, passesGuard, type GuardReason } from '../src/engine/llm/guard';
import { suggestRewrites, type Rewriter } from '../src/engine/llm/suggest';
import { adapterFor } from '../src/formats/registry';

const REFERENCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../trust/reference');
/** Keep equal to the fixed part of server_args in llm.rs. */
const FIXED_ARGS = ['--ctx-size', '1024', '--parallel', '1', '--cache-ram', '0', '--no-webui', '--reasoning', 'off', '--offline', '--no-slots'];

interface Row {
  doc: string;
  preset: PresetId;
  text: string;
  rewrite: string | null;
  seconds: number;
  firstTokenSeconds: number;
  promptTokens: number;
  cachedTokens: number;
  verdict: 'passed' | 'unchanged' | GuardReason;
}

/** llama-server's per-request timings (in the chat reply). */
interface Timings {
  prompt_n: number;
  prompt_ms: number;
  predicted_n: number;
  predicted_ms: number;
  cache_n: number;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

/** Peak working set and peak private bytes of a process, in MB. */
function peakMemory(pid: number): { workingSetMb: number; privateMb: number } {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `$p = Get-Process -Id ${pid}; "$($p.PeakWorkingSet64) $($p.PeakPagedMemorySize64)"`]).toString().trim();
  const [ws, priv] = out.split(' ').map(Number);
  return { workingSetMb: Math.round(ws / 2 ** 20), privateMb: Math.round(priv / 2 ** 20) };
}

async function waitForHealth(url: string, exited: () => boolean): Promise<void> {
  for (let i = 0; i < 240; i++) {
    if (exited()) throw new Error('llama-server exited before it was ready.');
    try {
      if ((await fetch(url)).status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('llama-server did not answer /health within 2 minutes.');
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
};

async function main(): Promise<void> {
  const [exe, model, output] = process.argv.slice(2);
  if (!exe || !model) throw new Error('Usage: npm run measure:llm -- <llama-server.exe> <model.gguf> [output.json]');
  const port = await freePort();
  const apiKey = randomBytes(32).toString('hex');
  const args = ['--model', model, '--host', '127.0.0.1', '--port', String(port), ...FIXED_ARGS];
  const server = spawn(exe, args, { env: { ...process.env, LLAMA_API_KEY: apiKey }, stdio: ['ignore', 'ignore', 'pipe'] });
  // The end of the server's log, printed if it stops during the run.
  let logTail = '';
  server.stderr.on('data', (chunk) => (logTail = (logTail + String(chunk)).slice(-6000)));
  let exited = false;
  server.on('exit', (code) => {
    exited = true;
    process.stderr.write(`llama-server exited (code ${code}). Last log lines:\n${logTail}\n`);
  });
  const rows: Row[] = [];
  try {
    const started = Date.now();
    await waitForHealth(`http://127.0.0.1:${port}/health`, () => exited);
    const loadSeconds = (Date.now() - started) / 1000;
    // Reads the server's timings off each reply without changing what the client sees.
    let last: Timings | null = null;
    const timingFetch: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      last = ((await res.clone().json()) as { timings?: Timings }).timings ?? null;
      return res;
    };
    const client = new LlmClient({ port, apiKey, fetch: timingFetch });
    const warmup = await timeOneSentence(client, new AbortController().signal);
    const linter = await createLinter('American');
    const { docs } = JSON.parse(fs.readFileSync(path.join(REFERENCE, 'manifest.json'), 'utf8')) as { docs: { file: string; preset: PresetId }[] };
    for (const doc of docs) {
      const adapter = adapterFor(doc.file)!;
      const { paras } = await adapter.read(new Uint8Array(fs.readFileSync(path.join(REFERENCE, doc.file))));
      const session = await CheckSession.start(
        paras,
        { preset: doc.preset, fallbackVariant: 'American', language: adapter.language, dictionary: [], depth: 'standard', modules: { ...DEFAULT_MODULES, aiRewrites: true } },
        { linter },
      );
      const timed: Rewriter = {
        async rewrite(text, preset, signal) {
          const t = performance.now();
          last = null;
          const rewrite = await client.rewrite(text, preset, signal);
          const seconds = (performance.now() - t) / 1000;
          const timings = last as Timings | null;
          // First token: the prompt plus one generated token (llama-server reports both times).
          const firstTokenSeconds = timings ? (timings.prompt_ms + timings.predicted_ms / Math.max(1, timings.predicted_n)) / 1000 : seconds;
          const verdict = rewrite === null ? 'unchanged' : (passesGuard(text, rewrite, lockedTokens(text)).reason ?? 'passed');
          rows.push({ doc: doc.file, preset, text, rewrite, seconds, firstTokenSeconds, promptTokens: timings?.prompt_n ?? 0, cachedTokens: timings?.cache_n ?? 0, verdict });
          return rewrite;
        },
      };
      await suggestRewrites(session, timed, doc.preset, new AbortController().signal, { more: true });
      process.stderr.write(`${doc.file}: ${rows.filter((r) => r.doc === doc.file).length} sentences\n`);
    }
    const memory = peakMemory(server.pid!);
    const count = (v: Row['verdict']) => rows.filter((r) => r.verdict === v).length;
    const summary = {
      build: path.basename(path.dirname(exe)),
      model: path.basename(model),
      args: FIXED_ARGS.join(' '),
      loadSeconds,
      warmupSeconds: warmup.seconds,
      sentences: rows.length,
      passed: count('passed'),
      passRate: rows.length ? count('passed') / rows.length : 0,
      verdicts: Object.fromEntries([...new Set(rows.map((r) => r.verdict))].map((v) => [v, count(v)])),
      seconds: stats(rows.map((r) => r.seconds)),
      firstTokenSeconds: stats(rows.map((r) => r.firstTokenSeconds)),
      meanPromptTokens: Math.round(rows.reduce((n, r) => n + r.promptTokens, 0) / Math.max(1, rows.length)),
      meanCachedTokens: Math.round(rows.reduce((n, r) => n + r.cachedTokens, 0) / Math.max(1, rows.length)),
      peakWorkingSetMb: memory.workingSetMb,
      peakPrivateMb: memory.privateMb,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (output) fs.writeFileSync(output, JSON.stringify({ summary, rows }, null, 2));
  } catch (e) {
    process.stderr.write(`The run failed. Last llama-server log lines:\n${logTail}\n`);
    throw e;
  } finally {
    server.kill();
  }
}

await main();
