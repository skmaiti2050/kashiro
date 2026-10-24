import { describe, it, expect } from 'vitest';
import { countWords, wordsOf } from '@/engine/words';

describe('countWords: English', () => {
  it('counts numbers, contractions and hyphenated words once', () => {
    expect(wordsOf("It's 1,20,000 rupees, a well-known 3.2% rise.")).toEqual(["It's", '1,20,000', 'rupees', 'a', 'well-known', '3.2', 'rise']);
  });
});

describe('countWords: Hindi and Bengali (vowel signs, virama, nukta and the joiners stay inside a word)', () => {
  it('Hindi: vowel signs, anusvara, chandrabindu and nukta', () => {
    // ज़: ja with the nukta as its own combining mark (ज़), as many keyboards type it.
    expect(wordsOf('हिंदी भाषा माँ ज़रूरी')).toEqual(['हिंदी', 'भाषा', 'माँ', 'ज़रूरी']);
  });

  it('Hindi: conjuncts made with the virama', () => {
    expect(wordsOf('क्षत्रिय विद्यालय में पढ़ते हैं।')).toEqual(['क्षत्रिय', 'विद्यालय', 'में', 'पढ़ते', 'हैं']);
  });

  it('Bengali: vowel signs and conjuncts', () => {
    expect(countWords('আমি বাংলায় কথা বলি। ক্ষমা করবেন।')).toBe(6);
  });

  it('a zero-width joiner or non-joiner inside a word keeps it one word', () => {
    // Bengali র‍্যাব (ra + ZWJ + virama + ya, the "rya" form) and Hindi क्‌ष (ka + virama + ZWNJ + ssa, no conjunct).
    expect(wordsOf('র‍্যাব এসেছে')).toEqual(['র‍্যাব', 'এসেছে']);
    expect(wordsOf('क्‌ष और')).toEqual(['क्‌ष', 'और']);
  });

  it('a sentence mixing English and Hindi counts each word once', () => {
    expect(countWords('The हिन्दी class starts at 9.')).toBe(6);
  });
});
