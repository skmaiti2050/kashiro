import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { CheckSession } from '../src/engine/session';
import type { Candidate } from '../src/engine/types';
import { run, acceptAllRules } from '../cli/run';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-cli-'));
afterEach(() => vi.restoreAllMocks());

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
  return { out, err };
}

describe('check-file CLI', () => {
  it('runs with the network blocked, fixes teh, prints JSON, writes report', async () => {
    const input = path.join(dir, 'in.txt');
    const output = path.join(dir, 'out.txt');
    const report = path.join(dir, 'report.md');
    fs.writeFileSync(input, Buffer.from('\ufeffI think teh cat sat.\r\n\r\nSecond paragraph here.\r\n'));

    const boom = () => {
      throw new Error('network access attempted');
    };
    const saved = {
      fetch: globalThis.fetch,
      http: http.request,
      https: https.request,
      connect: net.connect,
      create: net.createConnection,
    };
    let code: number | undefined;
    let out: string[] = [];
    let positiveControl = false;
    try {
      // Harper's inlined wasm is loaded via fetch(data:...), which never touches the network: allow only that.
      globalThis.fetch = ((input: unknown, init?: unknown) => {
        if (String(input).startsWith('data:')) return (saved.fetch as (...a: unknown[]) => unknown)(input, init);
        return boom();
      }) as never;
      (http as { request: unknown }).request = boom;
      (https as { request: unknown }).request = boom;
      (net as { connect: unknown }).connect = boom;
      (net as { createConnection: unknown }).createConnection = boom;
      try {
        await fetch('http://example.invalid/');
      } catch (e) {
        positiveControl = (e as Error).message === 'network access attempted';
      }
      out = capture().out;
      code = await run([input, output, '--variant', 'American', '--report', report]);
    } finally {
      globalThis.fetch = saved.fetch;
      (http as { request: unknown }).request = saved.http;
      (https as { request: unknown }).request = saved.https;
      (net as { connect: unknown }).connect = saved.connect;
      (net as { createConnection: unknown }).createConnection = saved.create;
    }
    expect(positiveControl).toBe(true);
    expect(code).toBe(0);
    const json = JSON.parse(out.join('\n'));
    expect(Object.keys(json).sort()).toEqual(['decisions', 'mixedVariant', 'safe', 'unplaceable', 'variant']);
    expect(json.safe).toBeGreaterThanOrEqual(1);
    const bytes = fs.readFileSync(output);
    expect(bytes.toString('utf8')).toBe('\ufeffI think the cat sat.\r\n\r\nSecond paragraph here.\r\n');
    expect(fs.readFileSync(report, 'utf8')).toContain('# Writing check report');
  });

  it('refuses an output path equal to the input (case-insensitive on Windows)', async () => {
    const { err } = capture();
    const input = path.join(dir, 'same.txt');
    fs.writeFileSync(input, 'teh');
    const alias = process.platform === 'win32' ? input.toUpperCase() : input;
    expect(await run([input, alias])).toBe(1);
    expect(err.join('\n')).toContain('output must differ from input');
    expect(fs.readFileSync(input, 'utf8')).toBe('teh');
  });

  it('acceptAllRules skips batch members superseded by an earlier accept', async () => {
    const cand = (id: string, start: number, end: number, original: string): Candidate => ({
      id,
      paraId: 0,
      span: { start, end },
      original,
      replacements: ['X'],
      kind: 'Style',
      message: 'm',
      source: 'rules',
    });
    const session = await CheckSession.start(
      [{ id: 0, text: 'alpha beta gamma delta' }],
      { preset: 'blog', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [] },
    );
    // Same kind/original/replacement => one batch decision; the first two overlap.
    session.addCandidates([cand('a', 0, 5, 'alpha'), cand('b', 0, 5, 'alpha'), cand('c', 6, 10, 'alpha')]);
    expect(() => acceptAllRules(session)).not.toThrow();
    const applied = session.acceptedEdits();
    expect(applied.some((e) => e.span.start === 6)).toBe(true);
    expect(applied.filter((e) => e.span.start === 0)).toHaveLength(1);
  });

  it('acceptAllRules accepts only candidates with exactly one replacement', async () => {
    const session = await CheckSession.start(
      [{ id: 0, text: 'alpha beta gamma delta' }],
      { preset: 'blog', variant: 'American', fallbackVariant: 'American', language: 'plaintext', dictionary: [] },
    );
    const base = { paraId: 0, kind: 'Style', message: 'm', source: 'rules' as const };
    session.addCandidates([
      { ...base, id: 'choice', span: { start: 0, end: 5 }, original: 'alpha', replacements: ['ad', 'and'] },
      { ...base, id: 'one', span: { start: 6, end: 10 }, original: 'beta', replacements: ['BETA'] },
    ]);
    acceptAllRules(session);
    const applied = session.acceptedEdits();
    expect(applied.some((e) => e.span.start === 0)).toBe(false);
    expect(applied.some((e) => e.span.start === 6 && e.replacement === 'BETA')).toBe(true);
  });

  it('--accept-all-rules fixes typos but leaves fact-locked names alone', async () => {
    const input = path.join(dir, 'names.txt');
    const output = path.join(dir, 'names.out.txt');
    fs.writeFileSync(input, 'We met Anjali Sharma in Pune. I think teh cat sat.\n');
    capture();
    expect(await run([input, output, '--variant', 'American', '--accept-all-rules'])).toBe(0);
    const text = fs.readFileSync(output, 'utf8');
    expect(text).toContain('Anjali Sharma');
    expect(text).toContain('the cat');
    expect(text).not.toContain('teh');
  });

  it('exits 1 with a message for unknown extension and non-UTF-8', async () => {
    const { err } = capture();
    const bad = path.join(dir, 'x.xyz');
    fs.writeFileSync(bad, 'hi');
    expect(await run([bad, path.join(dir, 'o.xyz')])).toBe(1);
    const latin = path.join(dir, 'l.txt');
    fs.writeFileSync(latin, Buffer.from([0x68, 0xe9, 0x6c]));
    expect(await run([latin, path.join(dir, 'o.txt')])).toBe(1);
    expect(await run([path.join(dir, 'missing.txt'), path.join(dir, 'o.txt')])).toBe(1);
    expect(err.join('\n')).toContain('not UTF-8 text');
  });
});
