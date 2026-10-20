/**
 * Builds resources/dictionary/oewn.json.gz from an Open English WordNet WN-LMF release.
 *
 * Source: Open English WordNet 2025 edition (plain, not "plus")
 * URL:    https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz
 * sha256: 9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe
 * Licence: WordNet License + CC BY 4.0 (see resources/dictionary/ATTRIBUTION.md)
 *
 * Usage: npm run build:dictionary -- <english-wordnet-2025.xml.gz>
 *
 * The XML is ~90 MB, so it is read with regular expressions over the text instead of a DOM parser
 * (fast-xml-parser would build a tree several times the size of the file). The format is regular,
 * machine-written WN-LMF, one element per block.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DictionaryData, PosCode } from '../src/engine/dictionary/types';

export const PINNED_SHA256 = '9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe';
export const MAX_SENSES_PER_POS = 3;
export const MAX_SYNONYMS = 5;

interface SynsetInfo {
  pos: PosCode;
  definition: string;
  example: string;
  memberEntryIds: string[];
}
interface EntryInfo {
  id: string;
  lemma: string;
  pos: PosCode;
  forms: string[];
  synsetIds: string[];
}

const ENTRY_BLOCK = /<LexicalEntry id="([^"]*)">([\s\S]*?)<\/LexicalEntry>/g; // one <LexicalEntry ...>...</LexicalEntry>
const SYNSET_BLOCK = /<Synset ([^>]*)>([\s\S]*?)<\/Synset>/g; // one <Synset id=".." members=".." ...>...</Synset>
const LEMMA_TAG = /<Lemma writtenForm="([^"]*)" partOfSpeech="(.)"/; // <Lemma writtenForm="good" partOfSpeech="a"
const FORM_TAG = /<Form writtenForm="([^"]*)"/g; // <Form writtenForm="geese"/>
const SENSE_SYNSET = /<Sense [^>]*?synset="([^"]*)"/g; // <Sense id="..." subcat="vtaa" synset="oewn-01858313-n"
const DEFINITION_TAG = /<Definition>([\s\S]*?)<\/Definition>/; // first definition of a synset
const EXAMPLE_TAG = /<Example>([\s\S]*?)<\/Example>/; // first example of a synset
const XML_ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g; // &apos; or &#8217;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(XML_ENTITY, (_match, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return NAMED_ENTITIES[name];
  });
}

function attribute(attributes: string, name: string): string {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes);
  return match ? decodeXml(match[1]) : '';
}

/** Adjective satellites ('s') read as adjectives; anything else unknown is skipped. */
function toPosCode(code: string): PosCode | undefined {
  if (code === 's') return 'a';
  return code === 'n' || code === 'v' || code === 'a' || code === 'r' ? code : undefined;
}

function readEntries(xml: string): EntryInfo[] {
  const entries: EntryInfo[] = [];
  for (const block of xml.matchAll(ENTRY_BLOCK)) {
    const body = block[2];
    const lemmaTag = LEMMA_TAG.exec(body);
    const pos = lemmaTag ? toPosCode(lemmaTag[2]) : undefined;
    if (!lemmaTag || !pos) continue;
    // Phrases ("bear upon") are never looked up as one selected word and are half the entries; they stay as synonyms.
    if (lemmaTag[1].includes(" ")) continue;
    entries.push({
      id: decodeXml(block[1]),
      lemma: decodeXml(lemmaTag[1]).toLowerCase(),
      pos,
      forms: [...body.matchAll(FORM_TAG)].map((form) => decodeXml(form[1]).toLowerCase()),
      synsetIds: [...body.matchAll(SENSE_SYNSET)].map((sense) => decodeXml(sense[1])),
    });
  }
  return entries;
}

function readSynsets(xml: string): Map<string, SynsetInfo> {
  const synsets = new Map<string, SynsetInfo>();
  for (const block of xml.matchAll(SYNSET_BLOCK)) {
    const pos = toPosCode(attribute(block[1], 'partOfSpeech'));
    const definition = DEFINITION_TAG.exec(block[2]);
    if (!pos || !definition) continue;
    const example = EXAMPLE_TAG.exec(block[2]);
    synsets.set(attribute(block[1], 'id'), {
      pos,
      definition: decodeXml(definition[1]).trim(),
      example: example ? decodeXml(example[1]).trim() : '',
      memberEntryIds: attribute(block[1], 'members').split(/\s+/).filter(Boolean),
    });
  }
  return synsets;
}

/** Synonyms are the synset's other members, capped; the headword itself is never listed. */
function synonymsOf(synset: SynsetInfo, lemma: string, lemmaByEntryId: Map<string, string>): string[] {
  const synonyms: string[] = [];
  for (const entryId of synset.memberEntryIds) {
    const member = lemmaByEntryId.get(entryId);
    if (!member || member === lemma || synonyms.includes(member)) continue;
    synonyms.push(member);
    if (synonyms.length === MAX_SYNONYMS) break;
  }
  return synonyms;
}

/** Converts WN-LMF XML text into the compact lookup data (spec §3 item 9). */
export function convertWordnet(xml: string): DictionaryData {
  const entries = readEntries(xml);
  const synsets = readSynsets(xml);
  const lemmaByEntryId = new Map(entries.map((entry) => [entry.id, entry.lemma]));

  // Null-prototype objects: lemmas such as "constructor" must not hit Object.prototype.
  const data: DictionaryData = { format: 1, entries: Object.create(null), exceptions: Object.create(null) };
  const seenSynsets = new Map<string, Set<string>>(); // "lemma|pos" -> synset ids already stored
  const sensesPerPos = new Map<string, number>(); // "lemma|pos" -> count

  for (const entry of entries) {
    const key = `${entry.lemma}|${entry.pos}`;
    for (const synsetId of entry.synsetIds) {
      const synset = synsets.get(synsetId);
      if (!synset) continue;
      const seen = seenSynsets.get(key) ?? new Set<string>();
      seenSynsets.set(key, seen);
      const count = sensesPerPos.get(key) ?? 0;
      if (count >= MAX_SENSES_PER_POS || seen.has(synsetId)) continue;
      seen.add(synsetId);
      sensesPerPos.set(key, count + 1);
      const rows = Object.hasOwn(data.entries, entry.lemma) ? data.entries[entry.lemma] : [];
      rows.push([entry.pos, synset.definition, synset.example, synonymsOf(synset, entry.lemma, lemmaByEntryId)]);
      data.entries[entry.lemma] = rows;
    }
    for (const form of entry.forms) {
      if (form !== entry.lemma && Object.hasOwn(data.entries, entry.lemma) && !Object.hasOwn(data.exceptions, form)) {
        data.exceptions[form] = entry.lemma;
      }
    }
  }
  return data;
}

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Usage: npm run build:dictionary -- <english-wordnet-2025.xml.gz>');
  }
  const compressed = readFileSync(inputPath);
  const actual = createHash('sha256').update(compressed).digest('hex');
  if (actual !== PINNED_SHA256) {
    throw new Error(`Wrong source file: sha256 is ${actual}, expected ${PINNED_SHA256} (Open English WordNet 2025).`);
  }
  const data = convertWordnet(gunzipSync(compressed).toString('utf8'));
  const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), '../resources/dictionary/oewn.json.gz');
  mkdirSync(dirname(outputPath), { recursive: true });
  const output = gzipSync(JSON.stringify(data), { level: 9 });
  writeFileSync(outputPath, output);
  console.log(`${Object.keys(data.entries).length} lemmas, ${output.length} bytes -> ${outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
