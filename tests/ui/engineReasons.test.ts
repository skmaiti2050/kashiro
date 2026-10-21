// Change-log reasons and "couldn't place it" texts through the message-key layer (Task L1).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createTranslator } from '@/ui/i18n/translator';
import { reasonMessage, unplaceableMessage } from '@/ui/state/engineReasons';
import { english } from './english';

const hi = createTranslator('hi', ['hi-IN']);

describe('reasonMessage', () => {
  it('the engine’s reasons, in English and Hindi', () => {
    expect(english(reasonMessage('"teh" added to dictionary'))).toBe('“teh” added to dictionary');
    expect(hi.format(reasonMessage('"teh" added to dictionary'))).toBe('“teh” डिक्शनरी में जोड़ा गया');
    expect(english(reasonMessage('undone'))).toBe('undone');
    expect(english(reasonMessage('unplaceable: overlaps another edit'))).toBe('couldn’t place it: overlaps another edit');
    expect(hi.format(reasonMessage('unplaceable: overlaps another edit'))).toBe('नहीं लगाया जा सका: किसी दूसरे बदलाव से टकराता है');
  });

  it('an unknown reason is shown as it is', () => {
    expect(hi.format(reasonMessage('something new'))).toBe('something new');
  });
});

describe('unplaceableMessage', () => {
  it('has a key for every reason the formats can give', () => {
    const sources = ['src/formats/docx/write.ts', 'src/formats/text.ts'].map((path) => readFileSync(path, 'utf8')).join('\n');
    const reasons = [...sources.matchAll(/(?:return|reason:)\s*'([^']+)'/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(10);
    for (const reason of reasons) expect(unplaceableMessage(reason).key, reason).not.toBe('error.plain');
  });
});
