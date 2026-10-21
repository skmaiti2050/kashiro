/**
 * Held-out ranking check (spec §5 better suggestions): classic English misspellings that are NOT planted
 * in the reference corpus (whose errors tuned the weights), each linted by real Harper in a short sentence.
 * The intended word must be first for ≥ 85% of them and in the top 3 for ≥ 95%.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { improveSuggestions } from '@/engine/suggestions/improve';

const PAIRS: [string, string][] = [
  ['acheive', 'achieve'], ['accross', 'across'], ['agressive', 'aggressive'], ['apparantly', 'apparently'],
  ['arguement', 'argument'], ['basicly', 'basically'], ['begining', 'beginning'], ['beleive', 'believe'],
  ['bizzare', 'bizarre'], ['buisness', 'business'], ['calender', 'calendar'], ['catagory', 'category'],
  ['cemetary', 'cemetery'], ['collegue', 'colleague'], ['comming', 'coming'], ['commited', 'committed'],
  ['completly', 'completely'], ['concious', 'conscious'], ['curiousity', 'curiosity'], ['definately', 'definitely'],
  ['dissapoint', 'disappoint'], ['embarass', 'embarrass'], ['enviroment', 'environment'], ['existance', 'existence'],
  ['familar', 'familiar'], ['finaly', 'finally'], ['foriegn', 'foreign'], ['freind', 'friend'],
  ['goverment', 'government'], ['gaurd', 'guard'], ['happend', 'happened'], ['harrass', 'harass'],
  ['immediatly', 'immediately'], ['independant', 'independent'], ['knowlege', 'knowledge'], ['liason', 'liaison'],
  ['libary', 'library'], ['maintainance', 'maintenance'], ['neccessary', 'necessary'], ['noticable', 'noticeable'],
  ['ocassion', 'occasion'], ['persistant', 'persistent'], ['posession', 'possession'], ['prefered', 'preferred'],
  ['publically', 'publicly'], ['realy', 'really'], ['reccomend', 'recommend'], ['refered', 'referred'],
  ['relevent', 'relevant'], ['religous', 'religious'], ['rember', 'remember'], ['sucess', 'success'],
  ['suprise', 'surprise'], ['tommorow', 'tomorrow'], ['tounge', 'tongue'], ['truely', 'truly'],
  ['wierd', 'weird'], ['adn', 'and'], ['thier', 'their'], ['wich', 'which'],
  ['peice', 'piece'], ['writting', 'writing'],
];

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

/** 1-based rank of the intended word among the improved suggestions for `wrong`; Infinity when missing or not flagged. */
async function rankOf(wrong: string, right: string): Promise<number> {
  const text = `We saw the ${wrong} there.`;
  const flags = await linter.lintParagraphs([{ id: 0, text }], 'plaintext');
  const flag = flags.find((c) => c.original === wrong && (c.kind === 'Spelling' || c.kind === 'Typo'));
  if (!flag) return Infinity;
  const i = improveSuggestions(flag, text).replacements.indexOf(right);
  return i < 0 ? Infinity : i + 1;
}

describe('suggestion ranking on held-out misspellings (real Harper)', () => {
  it(`ranks the intended word first for ≥ 85% and in the top 3 for ≥ 95% of ${PAIRS.length} words`, async () => {
    const ranks = await Promise.all(PAIRS.map(([wrong, right]) => rankOf(wrong, right)));
    const first = ranks.filter((r) => r === 1).length / PAIRS.length;
    const top3 = ranks.filter((r) => r <= 3).length / PAIRS.length;
    const misses = PAIRS.filter((_, i) => ranks[i] !== 1).map(([w, r]) => `${w}→${r}`);
    expect({ first: first >= 0.85, top3: top3 >= 0.95, misses }).toMatchObject({ first: true, top3: true });
  }, 30_000);
});
