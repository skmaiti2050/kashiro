import type { Candidate, Paragraph, Span } from './types';
import { UPPER_START } from './wordFlags';

const CONTRACTIONS: Record<string, string[]> = {
  "can't": ['cannot'],
  "won't": ['will not'],
  "shan't": ['shall not'],
  "don't": ['do not'],
  "doesn't": ['does not'],
  "didn't": ['did not'],
  "isn't": ['is not'],
  "aren't": ['are not'],
  "wasn't": ['was not'],
  "weren't": ['were not'],
  "haven't": ['have not'],
  "hasn't": ['has not'],
  "hadn't": ['had not'],
  "wouldn't": ['would not'],
  "shouldn't": ['should not'],
  "couldn't": ['could not'],
  "mustn't": ['must not'],
  "needn't": ['need not'],
  "i'm": ['I am'],
  "you're": ['you are'],
  "we're": ['we are'],
  "they're": ['they are'],
  "i've": ['I have'],
  "you've": ['you have'],
  "we've": ['we have'],
  "they've": ['they have'],
  "i'll": ['I will'],
  "you'll": ['you will'],
  "he'll": ['he will'],
  "she'll": ['she will'],
  "it'll": ['it will'],
  "we'll": ['we will'],
  "they'll": ['they will'],
  "i'd": ['I would', 'I had'],
  "you'd": ['you would', 'you had'],
  "he'd": ['he would', 'he had'],
  "she'd": ['she would', 'she had'],
  "we'd": ['we would', 'we had'],
  "they'd": ['they would', 'they had'],
  "it's": ['it is', 'it has'],
  "he's": ['he is', 'he has'],
  "she's": ['she is', 'she has'],
  "that's": ['that is', 'that has'],
  "there's": ['there is', 'there has'],
  "what's": ['what is', 'what has'],
  "who's": ['who is', 'who has'],
  "let's": ['let us'],
};

function matchCase(original: string, full: string): string {
  const letters = original.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) return full.toUpperCase();
  if (UPPER_START.test(original)) return full[0].toUpperCase() + full.slice(1);
  return full;
}

/**
 * Academic preset: flags contractions with their full forms (kind 'Contraction', source 'preset').
 * Contractions inside `locked` spans (quotes, code, citations) are skipped.
 */
export function findContractions(p: Paragraph, locked: Span[] = []): Candidate[] {
  const out: Candidate[] = [];
  const re = /(?<![\p{L}\p{N}'’])[\p{L}]+['’][\p{L}]+(?![\p{L}\p{N}])/gu;
  for (const m of p.text.matchAll(re)) {
    const original = m[0];
    const full = CONTRACTIONS[original.toLowerCase().replace('’', "'")];
    if (!full) continue;
    const start = m.index!;
    const end = start + original.length;
    if (locked.some((s) => start < s.end && s.start < end)) continue;
    out.push({
      id: `${p.id}:${start}:${end}:Contraction`,
      paraId: p.id,
      span: { start, end },
      original,
      replacements: full.map((f) => matchCase(original, f)),
      kind: 'Contraction',
      message: 'Contraction in formal writing; consider the full form.',
      source: 'preset',
    });
  }
  return out;
}
