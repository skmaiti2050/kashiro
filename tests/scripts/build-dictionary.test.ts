import { describe, expect, it } from 'vitest';
import { convertWordnet } from '../../scripts/build-dictionary';

// Three entries in WN-LMF 1.3 shape: a noun with an irregular plural, a verb with many synonyms and
// senses (to test the caps) and an adjective whose synset has an escaped apostrophe.
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<LexicalResource>
  <Lexicon id="oewn" version="2025">
    <LexicalEntry id="oewn-goose-n">
      <Lemma writtenForm="goose" partOfSpeech="n"/>
      <Form writtenForm="geese"/>
      <Sense id="oewn-goose__1.05.00.." subcat="vtaa" synset="oewn-1-n"/>
    </LexicalEntry>
    <LexicalEntry id="oewn-run-v">
      <Lemma writtenForm="Run" partOfSpeech="v"/>
      <Form writtenForm="ran"/>
      <Sense id="oewn-run__2.38.00.." synset="oewn-2-v"/>
      <Sense id="oewn-run__2.38.01.." synset="oewn-3-v"/>
      <Sense id="oewn-run__2.38.02.." synset="oewn-4-v"/>
      <Sense id="oewn-run__2.38.03.." synset="oewn-5-v"/>
    </LexicalEntry>
    <LexicalEntry id="oewn-bear_upon-v"><Lemma writtenForm="bear upon" partOfSpeech="v"/><Sense id="x" synset="oewn-3-v"/></LexicalEntry>
    <LexicalEntry id="oewn-a1-v"><Lemma writtenForm="s1" partOfSpeech="v"/></LexicalEntry>
    <LexicalEntry id="oewn-a2-v"><Lemma writtenForm="s2" partOfSpeech="v"/></LexicalEntry>
    <LexicalEntry id="oewn-a3-v"><Lemma writtenForm="s3" partOfSpeech="v"/></LexicalEntry>
    <LexicalEntry id="oewn-a4-v"><Lemma writtenForm="s4" partOfSpeech="v"/></LexicalEntry>
    <LexicalEntry id="oewn-a5-v"><Lemma writtenForm="s5" partOfSpeech="v"/></LexicalEntry>
    <LexicalEntry id="oewn-a6-v"><Lemma writtenForm="s6" partOfSpeech="v"/></LexicalEntry>
    <LexicalEntry id="oewn-odd-s">
      <Lemma writtenForm="odd" partOfSpeech="s"/>
      <Sense id="oewn-odd__5.00.00.." synset="oewn-6-s"/>
    </LexicalEntry>
    <Synset id="oewn-1-n" members="oewn-goose-n" partOfSpeech="n">
      <Definition>web-footed long-necked birds</Definition>
      <Example>a flock of geese</Example>
      <Example>second example is dropped</Example>
    </Synset>
    <Synset id="oewn-2-v" members="oewn-run-v oewn-a1-v oewn-a2-v oewn-a3-v oewn-a4-v oewn-a5-v oewn-a6-v" partOfSpeech="v">
      <Definition>move fast by using one&apos;s feet</Definition>
    </Synset>
    <Synset id="oewn-3-v" members="oewn-run-v" partOfSpeech="v"><Definition>operate</Definition></Synset>
    <Synset id="oewn-4-v" members="oewn-run-v" partOfSpeech="v"><Definition>flow</Definition></Synset>
    <Synset id="oewn-5-v" members="oewn-run-v" partOfSpeech="v"><Definition>a fourth sense</Definition></Synset>
    <Synset id="oewn-6-s" members="oewn-odd-s" partOfSpeech="s"><Definition>not even</Definition></Synset>
  </Lexicon>
</LexicalResource>`;

describe('convertWordnet', () => {
  const data = convertWordnet(FIXTURE);

  it('writes [pos, definition, example, synonyms] rows keyed by lowercase lemma', () => {
    expect(data.entries.goose).toEqual([['n', 'web-footed long-necked birds', 'a flock of geese', []]]);
  });

  it('keeps at most 3 senses per part of speech and 5 synonyms per sense', () => {
    const rows = data.entries.run;
    expect(rows.map((row) => row[1])).toEqual(["move fast by using one's feet", 'operate', 'flow']);
    expect(rows[0][3]).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(rows[0][2]).toBe('');
  });

  it('does not index multi-word phrases as headwords', () => {
    expect(Object.keys(data.entries)).not.toContain('bear upon');
  });

  it('keeps inflection exceptions and reads adjective satellites as adjectives', () => {
    expect(data.exceptions).toEqual({ geese: 'goose', ran: 'run' });
    expect(data.entries.odd).toEqual([['a', 'not even', '', []]]);
  });
});
