import { describe, it, expect } from 'vitest';
import { sentenceSpans } from '@/engine/sentences';

const split = (text: string) => sentenceSpans(text).map((s) => text.slice(s.start, s.end));

describe('sentenceSpans', () => {
  it('splits at . ? ! followed by a space', () => {
    expect(split('One is here. Two is there? Three! ')).toEqual(['One is here.', 'Two is there?', 'Three!']);
  });

  it('keeps abbreviations, initials and decimals inside the sentence', () => {
    expect(split('Dr. Rao met R. K. Narayan, e.g. at 3.5 km on No. 5 Road. Then he left.')).toEqual([
      'Dr. Rao met R. K. Narayan, e.g. at 3.5 km on No. 5 Road.',
      'Then he left.',
    ]);
  });

  it('a code or unit ending in a capital ends a sentence ("234C.", "26 °C.")', () => {
    expect(split('Pay under 234C. It adds up at 26 °C. My kitchen')).toEqual(['Pay under 234C.', 'It adds up at 26 °C.', 'My kitchen']);
  });

  it('keeps closing quotes and brackets with the sentence', () => {
    expect(split('He said "go." She left (quietly.) The end')).toEqual(['He said "go."', 'She left (quietly.)', 'The end']);
  });

  it('a line break ends a sentence; Markdown line markers are not part of it', () => {
    expect(split('## Results\n- Attendance rose\n> Quoted line')).toEqual(['Results', 'Attendance rose', 'Quoted line']);
  });

  it('spans are offsets into the text', () => {
    const text = '  First one.   Second one.';
    expect(sentenceSpans(text)).toEqual([
      { start: 2, end: 12 },
      { start: 15, end: 26 },
    ]);
  });
});
