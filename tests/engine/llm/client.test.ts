import { describe, it, expect, vi } from 'vitest';
import { LlmClient } from '@/engine/llm/client';

const SENTENCE = 'The results was clear to everyone who seen them.'; // 48 chars ≈ 12 tokens

function fakeFetch(content: string) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ content }), { status: 200 }));
}

const live = () => new AbortController().signal;

describe('LlmClient.rewrite', () => {
  it('POSTs /completion on 127.0.0.1 at the given port, temperature 0.2, n_predict 1.6x the input tokens', async () => {
    const fetch = fakeFetch(' The results were clear to everyone who saw them.\n');
    const client = new LlmClient({ port: 8123, fetch });
    const out = await client.rewrite(SENTENCE, 'academic', live());

    expect(out).toBe('The results were clear to everyone who saw them.');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.protocol).toBe('http:');
    expect(parsed.hostname).toBe('127.0.0.1');
    expect(parsed.port).toBe('8123');
    expect(parsed.pathname).toBe('/completion');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.temperature).toBe(0.2);
    expect(body.n_predict).toBe(Math.ceil(1.6 * Math.ceil(SENTENCE.length / 4)));
    expect(body.prompt).toContain(SENTENCE);
    for (const phrase of ['one sentence', 'meaning', 'number', 'name', 'quote', 'term', 'hedge', 'new claims', 'UNCHANGED']) {
      expect(body.prompt).toContain(phrase);
    }
  });

  it('the prompt follows the writing goal', async () => {
    const academic = fakeFetch('UNCHANGED');
    const script = fakeFetch('UNCHANGED');
    await new LlmClient({ port: 1, fetch: academic }).rewrite(SENTENCE, 'academic', live());
    await new LlmClient({ port: 1, fetch: script }).rewrite(SENTENCE, 'script', live());
    const promptOf = (f: ReturnType<typeof fakeFetch>) => JSON.parse(String(f.mock.calls[0][1]?.body)).prompt;
    expect(promptOf(academic)).not.toBe(promptOf(script));
  });

  it.each(['UNCHANGED', ' unchanged. ', '', SENTENCE])('%j → null', async (content) => {
    const client = new LlmClient({ port: 8123, fetch: fakeFetch(content) });
    expect(await client.rewrite(SENTENCE, 'blog', live())).toBeNull();
  });

  it('an already-aborted signal rejects without calling the helper', async () => {
    const fetch = fakeFetch('x');
    const ac = new AbortController();
    ac.abort();
    await expect(new LlmClient({ port: 8123, fetch }).rewrite(SENTENCE, 'blog', ac.signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aborting while the helper works rejects', async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const ac = new AbortController();
    const pending = new LlmClient({ port: 8123, fetch }).rewrite(SENTENCE, 'blog', ac.signal);
    ac.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(fetch.mock.calls[0][1]?.signal).toBe(ac.signal);
  });

  it('an HTTP error or a reply without content throws a message the user can act on', async () => {
    const down = vi.fn(async () => new Response('busy', { status: 503 }));
    await expect(new LlmClient({ port: 8123, fetch: down }).rewrite(SENTENCE, 'blog', live())).rejects.toThrow(/503/);
    const odd = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(new LlmClient({ port: 8123, fetch: odd }).rewrite(SENTENCE, 'blog', live())).rejects.toThrow(/content/);
  });

  it('rejects a port that is not 1-65535', () => {
    for (const port of [0, 65536, 1.5, NaN]) expect(() => new LlmClient({ port })).toThrow(/port/);
  });
});
