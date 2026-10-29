/**
 * Task F21d (owner decision 2026-10-29, F21c adversarial review I-3): a doubling starts ticked only when its sentence
 * is a clear prose sentence. Each review found a new command shape whose doubling started ticked, so the tick now
 * needs positive evidence of prose instead of one more detected shape.
 */
import { describe, it, expect } from 'vitest';
import { isClearProseSentence } from '@/engine/clearProse';
import type { Span } from '@/engine/types';

/** isClearProseSentence for the first `word word` doubling in `text`, with `command` (a part of `text`) as command text. */
function clear(text: string, doubling = 'the the', command?: string): boolean {
  const start = text.indexOf(doubling);
  const commandText: Span[] = command === undefined ? [] : [{ start: text.indexOf(command), end: text.indexOf(command) + command.length }];
  return isClearProseSentence(text, { start, end: start + doubling.length }, commandText);
}

describe('isClearProseSentence (Task F21d)', () => {
  it.each([
    'We went to the the market.',
    'Did you go to the the market?',
    'What a day at the the market!',
    '“We went to the the market.”',
    '(We went to the the market.)',
    '“Bring me the the cardamom,” he said.',
    '3,912 essays went to the the panel.',
    '**NANDINI:** Slowly, and mostly through word of the the mouth.',
    'It rained. We went to the the market. Then we ate.',
    'Dr. Rao went to the the market.',
    'RAMESH: Fifty rupees. (He shakes his head.) Bring me the the cardamom.',
  ])('a clear sentence: %j', (text) => {
    expect(clear(text)).toBe(true);
  });

  it.each([
    ['no end mark', 'We went to the the market'],
    ['a colon at the end', 'We went to the the market:'],
    ['a semicolon at the end', "Update users set the the name = 'x' where id = 1;"],
    ['a lowercase start', 'we went to the the market.'],
    ['a lowercase start after a quote', '“we went to the the market.”'],
    ['fewer than four words', 'The the end.'],
    ['a list label', '- We went to the the market.'],
    ['a numbered list label', '2. We went to the the market.'],
    ['a list label before an earlier sentence on the line', '- It rained. We went to the the market.'],
    ['a line of its own in a paragraph', 'Steps:\nmake the the build\nmake install'],
    ['run then a word', 'To build, run make the the target and wait.'],
    ['type then a word', 'Type echo the the and press Enter.'],
    ['run, a dash, then a word', 'Run - make the the build - then test.'],
    ['run then any word that is no function word', 'Every night at 1, run backup the the db.'],
  ])('not clear: %s', (_name, text) => {
    expect(clear(text)).toBe(false);
  });

  // Task F21b E1: a hard-wrapped sentence (emails at 72 columns, wrapped Markdown) is read whole across a single break.
  it.each([
    'We went to the market early and\nsaw the the cardamom stall.',
    'Our team went to\nthe the market on Monday.',
    'We went to the market early and\r\nsaw the the cardamom stall.',
    'It rained all day, so we went to\nthe market late. Then we saw the the\ncardamom stall and went home.',
  ])('a hard-wrapped clear sentence: %j', (text) => {
    expect(clear(text)).toBe(true);
  });

  it.each([
    ['a blank line ends the sentence', 'We went to the market and\n\nthe the stall was shut.'],
    ['a list label on the next line ends it', 'We went to the market and\n- the the stall was shut.'],
    ['a wrapped list item keeps its label', '- We went to the market and\nthe the stall was shut.'],
    ['a wrapped command line', 'To build it, type\necho the the > out.txt.'],
    ['a wrapped line with no end mark', 'We went to the market and\nsaw the the stall'],
  ])('not clear across a break: %s', (_name, text) => {
    expect(clear(text)).toBe(false);
  });

  it('a line of command text is never joined to the prose next to it', () => {
    // The command line stays its own line, so the prose sentence under it is judged alone, as before.
    expect(clear('sudo apt-get update\nThe the server comes back.', 'The the', 'sudo apt-get update')).toBe(true);
    expect(clear('To update it we run\nsudo apt-get the the update.', 'the the', 'sudo apt-get the the update.')).toBe(false);
  });

  it('run or enter before a function word is prose: "run the the shop", "enter your name"', () => {
    expect(clear('They run the the shop on Main Street.')).toBe(true);
    expect(clear('Enter your name and and press OK.', 'and and')).toBe(true);
  });

  it('command text anywhere in the sentence, surely or maybe, makes it unclear; in another sentence it does not', () => {
    expect(clear('Use app.py to see the the output.', 'the the', 'Use app.py to see the the output.')).toBe(false);
    expect(clear('We ran it with app.py and saw the the output.', 'the the', 'app.py')).toBe(false);
    expect(clear('Run sudo reboot. The the server comes back.', 'The the', 'sudo reboot')).toBe(true);
  });
});
