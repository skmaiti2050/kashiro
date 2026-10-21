import type { Decision } from '@/engine/decisions';
import { sentenceSpans } from '@/engine/sentences';
import type { Candidate } from '@/engine/types';
import { CATEGORIES, categoryOf } from './categories';
import { plainMessage } from './plainMessages';

/** The fields of a SpeechSynthesisVoice the app reads (tests pass plain objects). */
export interface VoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export type ReadTarget = 'sentence' | 'suggestion' | 'paragraph';

/**
 * Voices that run on this PC. A network voice ("Microsoft Aria Online (Natural)") would send the text to a
 * server, so it is never offered or used; a voice that does not say it is local counts as a network one.
 */
export function localVoices<V extends VoiceInfo>(voices: readonly V[]): V[] {
  return voices.filter((v) => v.localService === true);
}

/** The local voice with `voiceURI`, else the default local voice, else the first local one; null with none. */
export function pickVoice<V extends VoiceInfo>(voices: readonly V[], voiceURI: string | null): V | null {
  const local = localVoices(voices);
  return local.find((v) => v.voiceURI === voiceURI) ?? local.find((v) => v.default) ?? local[0] ?? null;
}

/** The line (a paragraph in the document view) around `offset`, as offsets into `text`. */
function lineAround(text: string, offset: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const next = text.indexOf('\n', offset);
  return { start, end: next === -1 ? text.length : next };
}

/** The paragraph around `offset` ("Read paragraph"). */
export function paragraphAt(text: string, offset: number): string {
  const { start, end } = lineAround(text, offset);
  return text.slice(start, end).trim();
}

/** The sentence around `offset`, or the one just before it when the offset is between two ("Read sentence"). */
export function sentenceAt(text: string, offset: number): string {
  const line = lineAround(text, offset);
  const paragraph = text.slice(line.start, line.end);
  const at = offset - line.start;
  const spans = sentenceSpans(paragraph);
  const span = spans.find((s) => s.start <= at && at <= s.end) ?? spans.filter((s) => s.start <= at).at(-1) ?? spans[0];
  return span ? paragraph.slice(span.start, span.end) : '';
}

const quoted = (text: string) => `“${text}”`;

/**
 * What "Read suggestion" says, and the card's screen-reader name: the category and kind, the change
 * ("Change “recieve” to “receive” in 2 places"), then the flag's message. A word-list card reads its label.
 */
export function suggestionSpeech(decision: Decision, first: Candidate): string {
  const category = CATEGORIES[categoryOf(first, decision.kind)].label;
  if (decision.kind === 'names' || decision.kind === 'terms' || decision.kind === 'otherLanguage') return `${category}. ${decision.label}.`;
  const places = decision.kind === 'batch' ? ` in ${decision.candidateIds.length} places` : '';
  const fixes = first.replacements.filter((r) => r !== '');
  let change = quoted(first.original);
  if (first.replacements.length > 0 && fixes.length === 0) change = `Delete ${quoted(first.original)}`;
  else if (fixes.length > 0) change = `Change ${quoted(first.original)} to ${fixes.map(quoted).join(' or ')}`;
  return `${category}, ${first.kind}. ${change}${places}. ${plainMessage(first.message)}`;
}
