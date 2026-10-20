import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { run } from '../cli/check-file';

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
    fs.writeFileSync(input, Buffer.from('﻿I think teh cat sat.\r\n\r\nSecond paragraph here.\r\n'));

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
    // Harper's inlined wasm is loaded via fetch(data:...), which never touches the network: allow only that.
    globalThis.fetch = ((input: unknown, init?: unknown) => {
      if (String(input).startsWith('data:')) return (saved.fetch as (...a: unknown[]) => unknown)(input, init);
      return boom();
    }) as never;
    (http as { request: unknown }).request = boom;
    (https as { request: unknown }).request = boom;
    (net as { connect: unknown }).connect = boom;
    (net as { createConnection: unknown }).createConnection = boom;
    const { out } = capture();
    let code: number;
    try {
      code = await run([input, output, '--variant', 'American', '--report', report]);
    } finally {
      globalThis.fetch = saved.fetch;
      (http as { request: unknown }).request = saved.http;
      (https as { request: unknown }).request = saved.https;
      (net as { connect: unknown }).connect = saved.connect;
      (net as { createConnection: unknown }).createConnection = saved.create;
    }
    expect(code).toBe(0);
    const json = JSON.parse(out.join('\n'));
    expect(Object.keys(json).sort()).toEqual(['decisions', 'mixedVariant', 'safe', 'unplaceable', 'variant']);
    expect(json.safe).toBeGreaterThanOrEqual(1);
    const bytes = fs.readFileSync(output);
    expect(bytes.toString('utf8')).toBe('﻿I think the cat sat.\r\n\r\nSecond paragraph here.\r\n');
    expect(fs.readFileSync(report, 'utf8')).toContain('# Writing check report');
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
