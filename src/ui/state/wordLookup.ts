import type { Dictionary, LookupResult } from '@/engine/dictionary/lookup';
import type { MessageKey } from '../i18n/catalogues';
import { msg, type Message } from '../i18n/message';
import { explain } from './errors';
import type { Announcement } from './sessionController';

/** A letter, combining mark (Devanagari vowel signs) or digit: part of a word ("café", "किताब"). */
const WORD_CHAR = /[\p{L}\p{M}\p{Nd}]/u;
/** Joins two parts of one word when it sits between word characters: "well-known", "don’t". */
const JOINER = /['’-]/;
/** Spaces and punctuation at either end of a selection: " fox, " → "fox". */
const EDGES = /^[^\p{L}\p{M}\p{Nd}]+|[^\p{L}\p{M}\p{Nd}]+$/gu;
/** Runs of white space inside a selection (a phrase across a line break). */
const SPACES = /\s+/g;
/** A phrase rather than one word: "could of". */
const HAS_SPACE = /\s/;
/** Longer than this is a sentence, not a word or short phrase: there is nothing to look up. */
const MAX_LOOKUP_LENGTH = 40;

/**
 * The word to look up for a selection (`from` < `to`: the selected text without the spaces and punctuation
 * around it) or a caret (the word it touches), or null when there is none. Offsets are into `text`.
 */
export function wordToLookUp(text: string, from: number, to: number): string | null {
  const found = from < to ? text.slice(from, to).replace(EDGES, '').replace(SPACES, ' ') : wordAround(text, from);
  if (!found || found.length > MAX_LOOKUP_LENGTH) return null;
  return found;
}

/**
 * What "Look up" on a review item shows: the original and its first suggestion side by side (only the original
 * when there is no other suggestion). Null when the original is not one word: a phrase or sentence to rewrite.
 */
export function wordsToCompare(original: string, suggestion: string | undefined): string[] | null {
  const word = wordToLookUp(original, 0, original.length);
  if (!word || HAS_SPACE.test(word)) return null;
  const other = suggestion ? wordToLookUp(suggestion, 0, suggestion.length) : null;
  return other && other !== word ? [word, other] : [word];
}

/** The word that touches offset `at` on either side, joiners included. */
function wordAround(text: string, at: number): string | null {
  const isWordChar = (i: number) => i >= 0 && i < text.length && WORD_CHAR.test(text[i]);
  const isPart = (i: number) => isWordChar(i) || (JOINER.test(text[i] ?? '') && isWordChar(i - 1) && isWordChar(i + 1));
  let start = at;
  let end = at;
  while (isPart(start - 1)) start--;
  while (isPart(end)) end++;
  return end > start ? text.slice(start, end) : null;
}

/** What the lookup panel shows: the words asked for, and the dictionary's answer for each once it is loaded. */
export interface LookupState {
  words: string[];
  status: 'loading' | 'ready' | 'failed';
  /** One per word, in order, once ready. */
  results: LookupResult[];
  error: Message | null;
  /** "Definition loaded" or "No definition found", for the screen reader; `seq` is new each time. */
  announcement: Announcement | null;
}

/** Where the lookup gets its data: the controller's dictionary (null while word lookup is off) and personal words. */
export interface LookupSource {
  dictionary(): Promise<Dictionary> | null;
  personalWords(): readonly string[];
}

/**
 * The lookup panel's state, outside React: open() shows "Loading dictionary…" until the dictionary is ready,
 * then the result. Only the latest request is shown; a result arriving after close() is dropped. It only
 * reads: nothing here can change the document.
 */
export class WordLookup {
  private state: LookupState | null = null;
  private readonly listeners = new Set<() => void>();
  /** Requests made; an answer whose number is no longer the latest is dropped. */
  private requests = 0;
  private announcements = 0;

  constructor(private readonly source: LookupSource) {}

  /** Null while the panel is closed. */
  getState = (): LookupState | null => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async open(words: string[]): Promise<void> {
    const request = ++this.requests;
    this.set({ words, status: 'loading', results: [], error: null, announcement: null });
    const loading = this.source.dictionary();
    if (!loading) return this.fail(words, msg('lookup.unavailable'));
    let dictionary: Dictionary;
    try {
      dictionary = await loading;
    } catch (e) {
      if (request === this.requests) this.fail(words, explain(msg('lookup.failed'), e, msg('lookup.failedNext')));
      return;
    }
    if (request !== this.requests) return;
    const personal = new Set(this.source.personalWords());
    const results = words.map((word) => dictionary.lookup(word, { personal }));
    const found: MessageKey = results.some((r) => r.senses.length > 0) ? 'lookup.loaded' : 'lookup.noneFound';
    this.set({ words, status: 'ready', results, error: null, announcement: { message: msg(found), seq: ++this.announcements } });
  }

  close(): void {
    ++this.requests;
    if (this.state) this.set(null);
  }

  private fail(words: string[], error: Message): void {
    this.set({ words, status: 'failed', results: [], error, announcement: null });
  }

  private set(state: LookupState | null): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
