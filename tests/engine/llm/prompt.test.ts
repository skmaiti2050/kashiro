import { describe, expect, it } from 'vitest';
import { rewriteInstructions, sentenceMessage } from '@/engine/llm/prompt';
import type { Variant } from '@/engine/types';

const ruleOf = (variant: Variant) => rewriteInstructions('business', variant).split('\n')[1];

describe('rewriteInstructions', () => {
  it('keeps British and Indian spelling and punctuation, with no serial commas and no US spelling (owner rule)', () => {
    expect(ruleOf('British')).toBe('Keep the original British spelling and punctuation; do not add serial (Oxford) commas; do not change to US spelling.');
    expect(ruleOf('Indian')).toBe('Keep the original Indian spelling and punctuation; do not add serial (Oxford) commas; do not change to US spelling.');
  });

  it('Australian and Canadian English follow the same rule; American keeps US style', () => {
    expect(ruleOf('Australian')).toBe('Keep the original Australian spelling and punctuation; do not add serial (Oxford) commas; do not change to US spelling.');
    expect(ruleOf('Canadian')).toBe('Keep the original Canadian spelling and punctuation; do not add serial (Oxford) commas; do not change to US spelling.');
    expect(ruleOf('American')).toBe('Keep US spelling and punctuation.');
  });

  it('is byte-identical for every request with the same goal and variant (the server reuses it), and holds no sentence', () => {
    expect(rewriteInstructions('academic', 'Indian')).toBe(rewriteInstructions('academic', 'Indian'));
    expect(rewriteInstructions('academic', 'Indian')).not.toBe(rewriteInstructions('academic', 'British'));
    expect(rewriteInstructions('academic', 'Indian')).not.toBe(rewriteInstructions('blog', 'Indian'));
    expect(rewriteInstructions('academic', 'Indian')).not.toContain('<sentence>\n');
  });

  it('puts the sentence between delimiters in the user message', () => {
    expect(sentenceMessage('The results was clear.')).toBe('<sentence>\nThe results was clear.\n</sentence>');
  });
});
