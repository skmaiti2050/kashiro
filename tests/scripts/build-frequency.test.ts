import { describe, expect, it } from 'vitest';
import { convertFrequencyList } from '../../scripts/build-frequency';

const FIXTURE = [
  '# English word frequencies (Zipf scale) from wordfreq 3.1.1, wordlist=large',
  '# Data licence: CC BY-SA 4.0',
  'the\t7.73',
  'of\t7.68',
  'house\t5.52',
  'garden\t4.96',
  'Paris\t4.90',
  "don't\t4.80",
  'arrived\t4.79',
  'sarpanch\t1.96',
  '',
].join('\n');

describe('convertFrequencyList', () => {
  const data = convertFrequencyList(FIXTURE);

  it('groups lowercase words (apostrophes allowed) by Zipf frequency rounded to one decimal, in source order', () => {
    expect(data).toEqual({
      format: 1,
      buckets: [
        [7.7, 'the of'],
        [5.5, 'house'],
        [5, 'garden'],
        [4.8, "don't arrived"],
        [2, 'sarpanch'],
      ],
    });
  });

  it('rejects a list that is not sorted by frequency', () => {
    expect(() => convertFrequencyList('rare\t2.00\ncommon\t5.00\n')).toThrow(/sorted/);
  });
});
