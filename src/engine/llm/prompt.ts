import type { PresetId } from '../presets';

/** The register each writing goal asks for. */
const REGISTER: Record<PresetId, string> = {
  academic: 'formal academic English, without contractions',
  blog: 'plain, friendly English',
  script: 'natural spoken English that is easy to say aloud',
  business: 'clear, professional English',
};

/** What the helper must reply when a sentence already reads well. */
export const UNCHANGED = 'UNCHANGED';

/** A completion prompt asking for one rewritten sentence, nothing else. */
export function rewritePrompt(sentence: string, preset: PresetId): string {
  return [
    `Rewrite this one sentence so it reads naturally in ${REGISTER[preset]}.`,
    'Keep its meaning. Keep every number, name, quote and term exactly as written.',
    'Do not add any hedge (such as "broadly", "arguably" or "perhaps") and do not add new claims.',
    `Return the sentence only. If it already reads well, return ${UNCHANGED}.`,
    '',
    `Sentence: ${sentence}`,
    'Rewritten:',
  ].join('\n');
}
