/**
 * Profane and offensive words never offered as a spelling suggestion for an ordinary word (spec §5:
 * "Sujit" must never become "Shit"). Kept small on purpose: words a dictionary suggests by accident.
 */
export const OFFENSIVE_WORDS: ReadonlySet<string> = new Set(
  (
    'arse arsehole ass asses asshole assholes bastard bastards bitch bitches bitchy bollocks boner ' +
    'cock cocks crap crappy cum cunt cunts dick dicks dickhead dildo fag fags faggot faggots fuck fucked ' +
    'fucker fuckers fucking fucks hooker jizz nazi nazis nigga niggas nigger niggers piss pissed pisses ' +
    'porn porno pornographic pornography prick pricks pussy retard retarded retards shag shit shits shitty ' +
    'slut sluts tits titty twat ' +
    'wank wanker wankers whore whores'
  ).split(' '),
);

/** One word inside a suggestion: "bull shit" holds "bull" and "shit". */
const WORD = /[\p{L}]+/gu;

/** True when any word of `text` is on the offensive list ("Shit", "bull shit"; not "Scunthorpe"). */
export function isOffensive(text: string): boolean {
  return (text.toLowerCase().match(WORD) ?? []).some((word) => OFFENSIVE_WORDS.has(word));
}

/** Shorter offensive words start too many ordinary ones ("ass" in "assignmnet"). */
const MIN_PREFIX_LENGTH = 4;

/** True when the original starts with an offensive word ("shitt", "fuckin"): then the user meant it. */
export function writtenOnPurpose(original: string): boolean {
  const lower = original.toLowerCase();
  return [...OFFENSIVE_WORDS].some((word) => word.length >= MIN_PREFIX_LENGTH && lower.startsWith(word));
}
