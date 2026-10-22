import { describe, expect, it } from 'vitest';
import { checkUpstream } from '../../scripts/deps/upstream';
import type { Asset } from '../../scripts/deps/assets';

const asset = (upstream: Asset['upstream']): Asset => ({
  id: 'x',
  name: 'X',
  version: '1',
  status: 'pinned',
  sourceUrl: 'https://example.org',
  upstream,
  licence: 'MIT',
  licenceNote: '',
  sha256: null,
  localPath: null,
  outputSha256: null,
  buildScript: null,
});

/** A fetch that answers `body` for `url` and fails the test for any other URL (no network in tests). */
const fakeFetch = (url: string, body: unknown): typeof fetch =>
  (async (requested: string | URL | Request) => {
    expect(String(requested)).toBe(url);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

describe('checkUpstream (deps:status asset updates, network mocked)', () => {
  it('reads the latest GitHub release and compares it with the pinned one', async () => {
    const result = await checkUpstream(
      asset({ kind: 'github-release', repo: 'globalwordnet/english-wordnet', current: '2025-edition' }),
      fakeFetch('https://api.github.com/repos/globalwordnet/english-wordnet/releases/latest', { tag_name: '2026-edition' }),
    );
    expect(result).toEqual({ id: 'x', latest: '2026-edition', current: '2025-edition', update: true });
  });

  it('reads PyPI and Hugging Face', async () => {
    const pypi = await checkUpstream(asset({ kind: 'pypi', package: 'wordfreq', current: '3.1.1' }), fakeFetch('https://pypi.org/pypi/wordfreq/json', { info: { version: '3.1.1' } }));
    expect(pypi).toEqual({ id: 'x', latest: '3.1.1', current: '3.1.1', update: false });
    const hf = await checkUpstream(
      asset({ kind: 'huggingface-dataset', dataset: 'a/b', current: '2025-01-20' }),
      fakeFetch('https://huggingface.co/api/datasets/a/b', { lastModified: '2025-03-02T10:00:00.000Z' }),
    );
    expect(hf).toEqual({ id: 'x', latest: '2025-03-02', current: '2025-01-20', update: true });
  });

  it('says why it could not check instead of throwing', async () => {
    const failing = (async () => new Response('rate limited', { status: 403 })) as unknown as typeof fetch;
    expect(await checkUpstream(asset({ kind: 'pypi', package: 'wordfreq', current: '3.1.1' }), failing)).toEqual({
      id: 'x',
      error: 'HTTP 403 from https://pypi.org/pypi/wordfreq/json',
    });
    expect(await checkUpstream(asset({ kind: 'in-repo' }), failing)).toEqual({ id: 'x', error: 'no upstream to check (in-repo)' });
  });
});
