import type { PresetId } from '../presets';
import { rewriteInstructions, sentenceMessage, UNCHANGED } from './prompt';

/** Low temperature: the helper should edit, not invent. */
const TEMPERATURE = 0.2;
/** Room for a reply up to 1.5x the input, in tokens: the guard refuses anything longer anyway (spec §5). */
const OUTPUT_RATIO = 1.5;
/** The reply is one sentence on one line: generation stops at the first line break. */
const STOP = ['\n'];
/**
 * The longest sentence sent, in rough tokens. The server's context is 1,024 tokens (llm.rs): about 140 for
 * the instructions and chat template, the sentence, and 1.5x the sentence for the reply.
 */
const MAX_SENTENCE_TOKENS = 300;
/** "UNCHANGED", any case, with an optional period. */
const UNCHANGED_REPLY = new RegExp(`^${UNCHANGED}\\.?$`, 'i');

/** Rough token count of English text: about 4 characters per token. */
const approxTokens = (text: string) => Math.ceil(text.length / 4);

/** llama-server's OpenAI-style chat reply (only the part we read). */
interface ChatReply {
  choices?: { message?: { content?: unknown } }[];
}

/**
 * Talks to the local llama.cpp `llama-server` (started by the app shell) on 127.0.0.1 only:
 * the text never leaves the machine. Uses the chat endpoint, so the server wraps the prompt in the
 * model's own chat template (any instruct model works), and sends the per-launch key the shell made.
 */
export class LlmClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly fetch: typeof fetch;

  constructor({ port, apiKey, fetch: fetchFn = globalThis.fetch }: { port: number; apiKey: string; fetch?: typeof fetch }) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`The writing helper's port must be a whole number from 1 to 65535 (got ${port}).`);
    }
    if (!apiKey) throw new Error('The writing helper needs the key it was started with. Restart the helper.');
    this.url = `http://127.0.0.1:${port}/v1/chat/completions`;
    this.apiKey = apiKey;
    this.fetch = fetchFn;
  }

  /**
   * One rewritten sentence, or null when the helper finds nothing to change (or the sentence is too long for
   * its context, so it is not sent). One request per sentence. Rejects when `signal` aborts.
   */
  async rewrite(text: string, preset: PresetId, signal: AbortSignal): Promise<string | null> {
    signal.throwIfAborted();
    if (approxTokens(text) > MAX_SENTENCE_TOKENS) return null;
    const request: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: rewriteInstructions(preset) },
          { role: 'user', content: sentenceMessage(text) },
        ],
        temperature: TEMPERATURE,
        max_tokens: Math.ceil(OUTPUT_RATIO * approxTokens(text)),
        stop: STOP,
      }),
      signal,
      // A redirect could only lead off this machine.
      redirect: 'error',
    };
    const res = await this.send(request, signal);
    if (res.status === 401) throw new Error("The writing helper refused this app's key. Switch AI rewrites off and on again to restart it.");
    if (!res.ok) throw new Error(`The writing helper answered with HTTP ${res.status}. Try again, or restart the helper.`);
    let body: ChatReply;
    try {
      body = (await res.json()) as ChatReply;
    } catch {
      throw new Error(`The writing helper sent a reply that is not JSON. Check that port ${new URL(this.url).port} is llama-server.`);
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('The writing helper sent a reply without "content". Check that it is llama-server.');
    const reply = cleanReply(content);
    if (reply === '' || UNCHANGED_REPLY.test(reply) || reply === text.trim()) return null;
    return reply;
  }

  /**
   * POSTs the request, once more if the connection failed: llama-server closes a keep-alive connection after
   * about 5 idle seconds, and a POST on that closed connection fails before the server sees it. A cancel is
   * never retried.
   */
  private async send(request: RequestInit, signal: AbortSignal): Promise<Response> {
    // Called unbound: browsers throw "Illegal invocation" when fetch runs with `this` set to another object.
    const send = this.fetch;
    for (let attempt = 1; ; attempt++) {
      try {
        return await send(this.url, request);
      } catch (e) {
        // fetch rejects with a TypeError when the connection fails; anything else (a cancel) is passed on.
        if (signal.aborted || !(e instanceof TypeError)) throw e;
        if (attempt === 2) {
          throw new Error(`Could not reach the writing helper on port ${new URL(this.url).port}. Switch AI rewrites off and on again to restart it.`, { cause: e });
        }
      }
    }
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
