import type { PresetId } from '../presets';
import { rewritePrompt, UNCHANGED } from './prompt';

/** Low temperature: the helper should edit, not invent. */
const TEMPERATURE = 0.2;
/** Room for a reply up to 1.6x the input, in tokens. */
const OUTPUT_RATIO = 1.6;
/** The helper's reply ends at a blank line. */
const STOP = ['\n\n'];
/** "UNCHANGED", any case, with an optional period. */
const UNCHANGED_REPLY = new RegExp(`^${UNCHANGED}\\.?$`, 'i');

/** Rough token count of English text: about 4 characters per token. */
const approxTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Talks to the local llama.cpp `llama-server` (started by the app shell) on 127.0.0.1 only:
 * the text never leaves the machine.
 */
export class LlmClient {
  private readonly url: string;
  private readonly fetch: typeof fetch;

  constructor({ port, fetch: fetchFn = globalThis.fetch }: { port: number; fetch?: typeof fetch }) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`The writing helper's port must be a whole number from 1 to 65535 (got ${port}).`);
    }
    this.url = `http://127.0.0.1:${port}/completion`;
    this.fetch = fetchFn;
  }

  /** One rewritten sentence, or null when the helper finds nothing to change. Rejects when `signal` aborts. */
  async rewrite(text: string, preset: PresetId, signal: AbortSignal): Promise<string | null> {
    signal.throwIfAborted();
    // Called unbound: browsers throw "Illegal invocation" when fetch runs with `this` set to another object.
    const send = this.fetch;
    const res = await send(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: rewritePrompt(text, preset),
        temperature: TEMPERATURE,
        n_predict: Math.ceil(OUTPUT_RATIO * approxTokens(text)),
        stop: STOP,
      }),
      signal,
      // A redirect could only lead off this machine.
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`The writing helper answered with HTTP ${res.status}. Try again, or restart the helper.`);
    let body: { content?: unknown };
    try {
      body = (await res.json()) as { content?: unknown };
    } catch {
      throw new Error(`The writing helper sent a reply that is not JSON. Check that port ${new URL(this.url).port} is llama-server.`);
    }
    if (typeof body.content !== 'string') throw new Error('The writing helper sent a reply without "content". Check that it is llama-server.');
    const reply = cleanReply(body.content);
    if (reply === '' || UNCHANGED_REPLY.test(reply) || reply === text.trim()) return null;
    return reply;
  }
}

/** A label the model may echo from the prompt: "Rewritten: …", "Sentence: …". */
const LABEL = /^(?:rewritten|sentence)\s*:\s*/i;
/** The prompt's delimiters echoed around the reply: "<sentence>…</sentence>". */
const DELIMITERS = /^<sentence>\s*([\s\S]*?)\s*<\/sentence>$/;
/** Opening quote → its closing quote. */
const QUOTE_PAIRS: Record<string, string> = { '"': '"', '“': '”', "'": "'", '‘': '’' };

/** The reply without an echoed label, delimiters, or one pair of quotes wrapped around all of it. */
function cleanReply(content: string): string {
  let reply = content.trim().replace(LABEL, '');
  reply = (DELIMITERS.exec(reply)?.[1] ?? reply).trim();
  const close = QUOTE_PAIRS[reply[0]];
  const inner = reply.slice(1, -1);
  // Only when the quotes wrap the whole reply: '"Go," she said, "now."' keeps its quotes.
  if (close && reply.length >= 2 && reply.endsWith(close) && !inner.includes(reply[0]) && !inner.includes(close)) {
    reply = inner.trim();
  }
  return reply;
}
