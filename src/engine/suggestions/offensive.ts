import { withinOneEdit } from '../wordFlags';

/**
 * Profanity that is never part of an ordinary word, matched anywhere inside a suggestion: "Shit's",
 * "Dipshit", "bullshit", "motherfucker". The casualty is a rare word such as "mishit". Slurs that sit
 * inside ordinary words ("Scunthorpe", "niggle", "snigger", "swanky") are whole words below instead.
 */
const PROFANE_CORES = ['shit', 'fuck', 'bitch', 'whore', 'slut', 'twat'];

/**
 * Offensive words matched only as whole words, because they also start or sit inside ordinary words
 * ("Dickens", "cocktail", "class", "Hooker" the name). Accepted false positives for v1: these words are
 * also never suggested in their innocent senses (a "dick", a rooster, the names Dick and Hooker).
 */
const OFFENSIVE_WHOLE_WORDS: ReadonlySet<string> = new Set(
  (
    'arse arsehole arseholes ass asses asshole assholes badass bastard bastards bollocks boner cock cocks ' +
    'crap crappy cum cunt cunts dick dicks dickhead dickheads dildo dumbass fag fags faggot faggots hooker ' +
    'jackass jizz nazi nazis nigga niggas nigger niggers piss pissed pisses porn porno pornographic ' +
    'pornography prick pricks pussy retard retarded retards shag smartass tits titty wank wanker wankers'
  ).split(' '),
);

/** One word inside a suggestion: "Dick's" holds "dick" and "s". */
const WORD = /\p{L}+/gu;

/** True when `text` holds profanity ("Shit", "Dipshit", "Dick's"; not "Dickens", "suit" or "Scunthorpe"). */
export function isOffensive(text: string): boolean {
  const lower = text.toLowerCase();
  if (PROFANE_CORES.some((core) => lower.includes(core))) return true;
  return (lower.match(WORD) ?? []).some((word) => OFFENSIVE_WHOLE_WORDS.has(word));
}

/** Profane words a misspelt-on-purpose original is one edit from ("shitt", "fuckin"). */
const PROFANE_WORDS = [
  ...PROFANE_CORES,
  'shits', 'shitty', 'bullshit', 'fucks', 'fucked', 'fucker', 'fucking', 'motherfucker', 'bitches', 'bitchy',
  'whores', 'sluts',
];

/**
 * True when the user meant the profanity: the original holds a profane core and is one edit from a
 * profane word ("shitt" → "shit", "fuckin" → "fucking"). "Shital" and "Shitij" (names) are two edits from
 * "shit", and "Dickns" holds no core, so their suggestions are still filtered.
 */
export function writtenOnPurpose(original: string): boolean {
  const lower = original.toLowerCase();
  if (!PROFANE_CORES.some((core) => lower.includes(core))) return false;
  return PROFANE_WORDS.some((word) => withinOneEdit(lower, word));
}
