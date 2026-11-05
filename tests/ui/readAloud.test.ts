// Read aloud (Task A1 item 3): local voices only, and what each "Read …" action speaks.
import { describe, it, expect } from 'vitest';
import type { Decision } from '@/engine/decisions';
import type { Candidate } from '@/engine/types';
import { createScriptEngines } from '@/engine/scriptEngines';
import { SCRIPT_LANGUAGES } from '@/ui/proofreadingLabels';
import { caretLanguages, localVoices, paragraphAt, sentenceAt, suggestionSpeech, textLanguage, voiceFor, type VoiceInfo } from '@/ui/state/readAloud';
import { en } from './english';
import { fakeEngine } from '../fixtures/fakeEngines';

const voice = (name: string, localService: boolean, extra: Partial<VoiceInfo> = {}): VoiceInfo => ({
  voiceURI: name,
  name,
  lang: 'en-US',
  localService,
  default: false,
  ...extra,
});

describe('localVoices', () => {
  it('keeps only voices that run on this PC: a network voice would send the text away', () => {
    const voices = [
      voice('Microsoft David - English (United States)', true),
      voice('Microsoft Aria Online (Natural) - English (United States)', false),
      voice('Microsoft Heera - English (India)', true, { lang: 'en-IN' }),
    ];
    expect(localVoices(voices).map((v) => v.name)).toEqual(['Microsoft David - English (United States)', 'Microsoft Heera - English (India)']);
  });

  it('a voice that does not say it is local counts as a network voice', () => {
    const unknown = { ...voice('Odd', true), localService: undefined as unknown as boolean };
    expect(localVoices([unknown])).toEqual([]);
    expect(localVoices([])).toEqual([]);
  });
});

describe('voiceFor: the chosen voice and its fallbacks (English text)', () => {
  const david = voice('David', true);
  const heera = voice('Heera', true, { lang: 'en-IN', default: true });
  const online = voice('Aria Online', false, { default: true });

  it('the chosen local voice', () => {
    expect(voiceFor([david, heera], 'en', 'David')).toBe(david);
  });

  it('a saved choice that is gone or not local falls back to the default local voice, then the first', () => {
    expect(voiceFor([david, heera], 'en', 'Gone')).toBe(heera);
    expect(voiceFor([david, online], 'en', 'Aria Online')).toBe(david);
    expect(voiceFor([david], 'en', null)).toBe(david);
  });

  it('no local voice: nothing to speak with', () => {
    expect(voiceFor([online], 'en', 'Aria Online')).toBeNull();
    expect(voiceFor([], 'en', null)).toBeNull();
  });
});

describe('voiceFor (the voice for text in a language)', () => {
  const david = voice('David', true);
  const heera = voice('Heera', true, { lang: 'en-IN', default: true });
  const kalpana = voice('Kalpana', true, { lang: 'hi-IN' });
  const hemant = voice('Hemant', true, { lang: 'hi_IN', default: true });
  const onlineHindi = voice('Swara Online', false, { lang: 'hi-IN' });
  const tanishaa = voice('Tanishaa', true, { lang: 'bn-IN' });

  it('English text: the chosen voice when it is English, else the English default, else the first English one', () => {
    expect(voiceFor([david, heera, kalpana], 'en', 'David')).toBe(david);
    expect(voiceFor([david, heera, kalpana], 'en-XA', null)).toBe(heera);
    expect(voiceFor([kalpana, david], 'en', null)).toBe(david);
  });

  it('English text is never read by a Hindi or Bengali voice', () => {
    // A Hindi default voice (likely on Hindi-display Windows), listed first.
    expect(voiceFor([hemant, david, heera], 'en', null)).toBe(heera);
    expect(voiceFor([hemant, david], 'en', null)).toBe(david);
    // A Hindi voice the user chose (for Hindi cards).
    expect(voiceFor([david, kalpana], 'en', 'Kalpana')).toBe(david);
    // Only Hindi and Bengali voices: none for English.
    expect(voiceFor([kalpana, hemant, tanishaa], 'en', 'Kalpana')).toBeNull();
    // Network English voices still never count.
    expect(voiceFor([kalpana, voice('Aria Online', false)], 'en', null)).toBeNull();
  });

  it('Hindi or Bengali text: a local voice of that language (the chosen one, else the default, else the first)', () => {
    expect(voiceFor([david, kalpana, hemant], 'hi', 'Kalpana')).toBe(kalpana);
    expect(voiceFor([david, kalpana, hemant], 'hi', 'David')).toBe(hemant);
    expect(voiceFor([david, kalpana, tanishaa], 'bn', null)).toBe(tanishaa);
  });

  it('no local voice for the language: none (an English voice would garble it; a network one is never used)', () => {
    expect(voiceFor([david, heera], 'hi', null)).toBeNull();
    expect(voiceFor([david, onlineHindi], 'hi', 'Swara Online')).toBeNull();
    expect(voiceFor([david, kalpana], 'bn', null)).toBeNull();
  });
});

describe('sentenceAt and paragraphAt', () => {
  const text = 'Dr. Rao came home. She was tired!\n\nThe next day was calm.';

  it('the sentence around the offset ("Dr." does not end one)', () => {
    expect(sentenceAt(text, 5)).toBe('Dr. Rao came home.');
    expect(sentenceAt(text, text.indexOf('tired'))).toBe('She was tired!');
    expect(sentenceAt(text, text.length)).toBe('The next day was calm.');
  });

  it('between sentences, the one just before the offset', () => {
    expect(sentenceAt(text, text.indexOf(' She'))).toBe('Dr. Rao came home.');
  });

  it('the paragraph around the offset, with CRLF line breaks too', () => {
    expect(paragraphAt(text, 3)).toBe('Dr. Rao came home. She was tired!');
    expect(paragraphAt(text, text.length - 1)).toBe('The next day was calm.');
    expect(paragraphAt('One.\r\n\r\nTwo.', 9)).toBe('Two.');
  });

  it('empty text reads nothing', () => {
    expect(sentenceAt('', 0)).toBe('');
    expect(paragraphAt('', 0)).toBe('');
  });
});

describe('suggestionSpeech', () => {
  const candidate = (over: Partial<Candidate>): Candidate => ({
    id: 'c1',
    paraId: 0,
    span: { start: 0, end: 7 },
    original: 'recieve',
    replacements: ['receive'],
    kind: 'Spelling',
    message: 'Did you mean “receive”?',
    source: 'rules',
    ...over,
  });
  const single = { id: 'c1', kind: 'single', label: 'recieve', candidateIds: ['c1'] } as unknown as Decision;
  const speech = (decision: Decision, first: Candidate) => suggestionSpeech(en, decision, new Map([[first.id, first]]));

  it('a fix: category and kind label, before and after, then the message', () => {
    expect(speech(single, candidate({}))).toBe('Correctness: Spelling. Change “recieve” to “receive”. Did you mean “receive”?');
  });

  it('several suggestions, a deletion, and a flag with nothing to apply', () => {
    expect(speech(single, candidate({ replacements: ['its', 'it is'], kind: 'WordChoice', message: 'Check this word.' }))).toBe(
      'Clarity: Word choice. Change “recieve” to “its” or “it is”. Check this word.',
    );
    expect(speech(single, candidate({ original: 'the the', replacements: [''], kind: 'Repetition', message: 'Repeated word.' }))).toBe(
      'Correctness: Repeated words. Delete “the the”. Repeated word.',
    );
    expect(speech(single, candidate({ replacements: [], kind: 'Readability', message: 'This sentence is 42 words long.' }))).toBe(
      'Clarity: Readability. “recieve”. This sentence is 42 words long.',
    );
  });

  it('reads the plain-words explanation, not the grammar terms', () => {
    expect(speech(single, candidate({ original: 'a', replacements: ['the'], kind: 'Typo', message: 'Did you mean the definite article?' }))).toBe(
      'Correctness: Typos. Change “a” to “the”. Did you mean “the”?',
    );
  });

  it('a batch says how many places', () => {
    const batch = { id: 'batch:x', kind: 'batch', label: 'recieve', candidateIds: ['c1', 'c2'] } as unknown as Decision;
    expect(speech(batch, candidate({ message: 'Spelling.' }))).toBe('Correctness: Spelling. Change “recieve” to “receive” in 2 places. Spelling.');
  });

  it('a word-list card reads its title, counted in the UI language', () => {
    const names = { id: 'names', kind: 'names', label: 'engine label', candidateIds: ['c1'] } as unknown as Decision;
    expect(speech(names, candidate({}))).toBe('Names and places. 1 name or place.');
  });
});

describe('textLanguage', () => {
  it('names the language of the script the text is mostly in', () => {
    expect(textLanguage('यह एक वाक्य है।')).toBe('hi');
    expect(textLanguage('এটি একটি বাক্য।')).toBe('bn');
    expect(textLanguage('This is a sentence.')).toBe('en');
  });

  it('counts letters: Hindi with one Latin word is Hindi, and empty text is English', () => {
    expect(textLanguage('Kashiro का परीक्षण')).toBe('hi');
    expect(textLanguage('')).toBe('en');
  });
});

describe('caretLanguages', () => {
  const line = 'We met. यह एक परीक्षण है।';
  it('the sentence at the caret and the whole paragraph can differ in language', () => {
    expect(caretLanguages(line, 2)).toEqual({ sentence: 'en', paragraph: 'hi' });
    expect(caretLanguages(line, 12)).toEqual({ sentence: 'hi', paragraph: 'hi' });
  });
  it('an empty line is English', () => {
    expect(caretLanguages('', 0)).toEqual({ sentence: 'en', paragraph: 'en' });
  });
});

describe('SCRIPT_LANGUAGES (the read-aloud voice table)', () => {
  it('agrees with every engine own script and language', () => {
    const engines = [...createScriptEngines().values(), fakeEngine()];
    for (const { capabilities } of engines) expect(SCRIPT_LANGUAGES[capabilities.script ?? '']).toBe(capabilities.language);
  });
});
