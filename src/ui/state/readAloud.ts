import type { Decision } from '@/engine/decisions';
import { dominantScript } from '@/engine/uncheckedScripts';
import { sentenceSpans } from '@/engine/sentences';
import type { Candidate } from '@/engine/types';
import type { Translator } from '../i18n/translator';
import { SCRIPT_LANGUAGES } from '../proofreadingLabels';
import { CATEGORIES, categoryOf } from './categories';
import { kindLabel } from './kindLabels';
import { isWordCard, wordCardTitle } from './labels';
import { explanation } from './plainMessages';

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

/** "hi-IN" or "hi_IN" (some Windows voices) → "hi". */
const baseLanguage = (lang: string) => lang.split(/[-_]/)[0].toLowerCase();

/**
 * The local voice for text in `language`: one of that language (the chosen one, else the default, else the
 * first), or null. English text (the document) is never read by a Hindi or Bengali voice, and Hindi or
 * Bengali text never by an English one, which garbles it. The pseudo-locale (en-XA) counts as English.
 */
export function voiceFor<V extends VoiceInfo>(voices: readonly V[], language: string, voiceURI: string | null): V | null {
  const base = baseLanguage(language);
  const speaking = localVoices(voices).filter((v) => baseLanguage(v.lang) === base);
  return speaking.find((v) => v.voiceURI === voiceURI) ?? speaking.find((v) => v.default) ?? speaking[0] ?? null;
}

/** The language to read `text` in: that of the SCRIPT_LANGUAGES script with the most letters, else English. */
export function textLanguage(text: string): string {
  const script = dominantScript(text, Object.keys(SCRIPT_LANGUAGES));
  return (script && SCRIPT_LANGUAGES[script]) || 'en';
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

/**
 * What "Read suggestion" says, and the card's screen-reader name: the category and kind, the change
 * ("Change “recieve” to “receive” in 2 places"), then the flag's explanation. A word-list card reads its title.
 */
export function suggestionSpeech(t: Translator, decision: Decision, candidates: Map<string, Candidate>): string {
  const first = candidates.get(decision.candidateIds[0])!;
  const category = t.t(CATEGORIES[categoryOf(first, decision.kind)].label);
  if (isWordCard(decision)) return t.t('speech.wordCard', { category, title: wordCardTitle(t, decision, candidates) });
  const quoted = (text: string) => t.t('quote', { text });
  const fixes = first.replacements.filter((r) => r !== '');
  let change = quoted(first.original);
  if (first.replacements.length > 0 && fixes.length === 0) change = t.t('speech.delete', { from: quoted(first.original) });
  else if (fixes.length > 0) change = t.t('speech.change', { from: quoted(first.original), to: t.list(fixes.map(quoted), 'disjunction') });
  if (decision.kind === 'batch') change = t.t('speech.inPlaces', { change, count: decision.candidateIds.length });
  return t.t('speech.fix', { category, kind: kindLabel(t, first.kind), change, explanation: t.format(explanation(first)) });
}
