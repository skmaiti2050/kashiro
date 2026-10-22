/**
 * Builds resources/frequency/en-wordfreq.json from an export of the wordfreq English list.
 *
 * Source: wordfreq 3.1.1 (Robyn Speer et al.), `wordlist=large`, top 100,000 lowercase a-z words (with apostrophes: "don't") with
 *         their Zipf frequency, one "word<TAB>zipf" line each, most frequent first
 * URL:    https://github.com/rspeer/wordfreq (data: https://pypi.org/project/wordfreq/3.1.1/)
 * sha256: of the exported .tsv, pinned in deps/assets.json ("wordfreq")
 * Licence: data CC BY-SA 4.0 (see resources/frequency/ATTRIBUTION.md)
 *
 * Usage: npm run build:frequency -- <en-wordfreq-100k.tsv>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FrequencyData } from '../src/engine/suggestions/frequencyData';
import { pinnedSha256 } from './deps/assets';

export const PINNED_SHA256 = pinnedSha256('wordfreq');

/** One data line: "garden\t4.96" or "don't\t6.20". */
const DATA_LINE = /^([a-z]+(?:'[a-z]+)*)\t(\d+(?:\.\d+)?)$/;

/** Groups the words by Zipf frequency rounded to one decimal, keeping the source's frequency order. */
export function convertFrequencyList(tsv: string): FrequencyData {
  const buckets: [number, string][] = [];
  let previousZipf = Infinity;
  for (const line of tsv.split(/\r?\n/)) {
    const match = DATA_LINE.exec(line);
    if (!match) continue; // comments, blank lines, and anything that is not a lowercase a-z word (apostrophes allowed)
    const zipf = Number(match[2]);
    if (zipf > previousZipf) throw new Error(`The list must be sorted by frequency, most frequent first ("${line}").`);
    previousZipf = zipf;
    const rounded = Math.round(zipf * 10) / 10;
    const last = buckets.at(-1);
    if (last && last[0] === rounded) last[1] += ` ${match[1]}`;
    else buckets.push([rounded, match[1]]);
  }
  return { format: 1, buckets };
}

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Usage: npm run build:frequency -- <en-wordfreq-100k.tsv>');
  const source = readFileSync(inputPath);
  const actual = createHash('sha256').update(source).digest('hex');
  if (actual !== PINNED_SHA256) {
    throw new Error(`Wrong source file: sha256 is ${actual}, expected ${PINNED_SHA256} (wordfreq 3.1.1 export).`);
  }
  const data = convertFrequencyList(source.toString('utf8'));
  const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), '../resources/frequency/en-wordfreq.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  const output = JSON.stringify(data);
  writeFileSync(outputPath, output);
  const words = data.buckets.reduce((n, [, text]) => n + text.split(' ').length, 0);
  console.log(`${words} words in ${data.buckets.length} buckets, ${output.length} bytes -> ${outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
