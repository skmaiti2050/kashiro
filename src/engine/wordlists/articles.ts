/**
 * The vetted a/an table (Task F6, owner decision 2026-10-26). The simple-fixes card ticks an article swap by
 * default only before one of these words, and only toward the article listed here; every other swap is still
 * offered, unticked. The article follows the word's first *sound*, which its spelling doesn't always tell ("a
 * union", "an uncle", "an hour", "a house", "a one-off"), so the words are listed by hand rather than guessed.
 *
 * To add a word: put it in TAKES_A or TAKES_AN, in lowercase letters only, by how it is said in British, American
 * and Indian English alike. Leave it out when you aren't certain of its first sound in all three: most u-, eu-,
 * ew-, on- and h- words need that thought ("herb", "historic", "homage", "humble", "hotel" are left out on
 * purpose), and no abbreviation or initialism belongs here ("usb", "mla", "fir", "hr"). A word for TAKES_AN must
 * not also be a common verb (see TAKES_AN). tests/engine/articles.test.ts checks a sample, that each
 * vowel-letter word in TAKES_A, or consonant-letter word in TAKES_AN, is one it knows, and lists every u-, eu-,
 * ew-, on- and h- word of both lists in full, so a new one needs adding there too, after checking it by ear.
 */

/** Words said with a consonant sound first: "a" goes before them. */
export const TAKES_A = [
  // Said with a "you" or "w" sound, though spelled with a vowel.
  'european', 'euro', 'eulogy', 'one', 'once',
  'union', 'unique', 'unit', 'united', 'uniform', 'universe', 'universal', 'university', 'unanimous', 'unicorn',
  'usage', 'useful', 'useless', 'user', 'usual', 'utensil', 'utility',
  // A sounded "h".
  'hair', 'half', 'hall', 'hammer', 'hand', 'happy', 'hard', 'hat', 'head', 'headcount', 'heart', 'heavy', 'height',
  'high', 'hill', 'hint', 'hobby', 'hole', 'holiday', 'home', 'horse', 'house', 'huge', 'human', 'hundred', 'husband',
  // Other consonants.
  'bag', 'ball', 'banana', 'bank', 'bed', 'bike', 'bird', 'book', 'bottle', 'box', 'boy', 'bridge', 'building', 'bus',
  'business', 'button', 'cake', 'car', 'card', 'cast', 'cat', 'chair', 'chance', 'child', 'city', 'class', 'clock',
  'cloth', 'company', 'computer', 'cup', 'customer', 'day', 'decision', 'desk', 'destination', 'dog', 'door', 'doubt',
  'dream', 'driver', 'face', 'family', 'farm', 'father', 'field', 'film', 'fish', 'floor', 'friend', 'game', 'garden',
  'gift', 'girl', 'glass', 'goal', 'group', 'guest', 'job', 'journey', 'judge', 'key', 'king', 'kitchen', 'lake',
  'lamp', 'large', 'letter', 'list', 'little', 'local', 'lot', 'lunch', 'machine', 'man', 'map', 'market', 'meeting',
  'message', 'minute', 'moment', 'month', 'monthly', 'mother', 'name', 'network', 'new', 'night', 'note', 'number',
  'page', 'paper', 'park', 'party', 'payments', 'pen', 'person', 'phased', 'phone', 'picture', 'place', 'plan',
  'plate', 'point', 'problem', 'queen', 'question', 'randomised', 'reason', 'recharge', 'report', 'river', 'road',
  'room', 'rule', 'school', 'seat', 'shirt', 'shop', 'simple', 'small', 'soil', 'song', 'spreadsheet', 'statement',
  'story', 'street', 'student', 'system', 'table', 'teacher', 'team', 'test', 'thing', 'ticket', 'time', 'town',
  'tree', 'trip', 'van', 'video', 'village', 'visit', 'voice', 'walk', 'wall', 'week', 'window', 'woman', 'word',
  'world', 'writer', 'yard', 'year', 'young', 'youth', 'zone', 'zoo',
];

/**
 * Words said with a vowel sound first: "an" goes before them. No word here is also a common verb ("equal",
 * "increase", "end", "open"): after a one-letter variable the verb is meant ("Why does a equal b?"), so "a" there
 * is not an article (F6 re-review 5, I-2). TAKES_A keeps its verbs: its swaps start from "an", never a variable.
 */
export const TAKES_AN = [
  // A silent "h".
  'heir', 'heiress', 'honest', 'honorable', 'honorary', 'honourable', 'hour', 'hourly',
  // A "u" said as in "up" or "urge", not "you".
  'ugly', 'umbrella', 'unclear', 'uncle', 'underdog', 'underground', 'understanding', 'undertaking', 'unexpected',
  'unfair', 'unfinished', 'unfortunate', 'unhappy', 'unhealthy', 'unidentified', 'unknown', 'unlikely', 'unofficial',
  'unpaid', 'unpleasant', 'unpopular', 'unsafe', 'unusual', 'unwanted', 'uphill', 'upper', 'upward', 'urchin',
  'urgent', 'utmost',
  // Other vowels.
  'able', 'absence', 'absolute', 'academic', 'academy', 'accent', 'accident', 'accountant', 'achievement', 'acid',
  'active', 'activity', 'actor', 'actress', 'adult', 'advantage', 'adventure', 'advertisement', 'affair', 'agency',
  'agent', 'agreement', 'airline', 'airport', 'album', 'alien', 'alley', 'alliance', 'analysis', 'ancient', 'angel',
  'angry', 'animal', 'ankle', 'announcement', 'ant', 'apartment', 'apology', 'app', 'apple', 'application',
  'appointment', 'apron', 'area', 'argument', 'army', 'arrangement', 'arrow', 'art', 'article', 'artist', 'aspect',
  'assembly', 'assessment', 'asset', 'assignment', 'assistant', 'athlete', 'attitude', 'audience', 'awful',
  'eagle', 'ear', 'early', 'earring', 'earthquake', 'easy', 'edition', 'editor', 'effort', 'eight', 'eighteen',
  'eighty', 'election', 'electrician', 'element', 'elephant', 'elevator', 'embassy', 'emergency', 'emotion',
  'empire', 'employee', 'employer', 'enemy', 'engine', 'entry', 'envelope', 'episode', 'essay', 'estate', 'evening',
  'event', 'exam', 'example', 'excellent', 'exception', 'exhibition', 'expert', 'explanation', 'extension', 'extra',
  'icon', 'idea', 'ideal', 'identity', 'igloo', 'illness', 'important', 'impression', 'improvement', 'incident',
  'income', 'individual', 'industry', 'infant', 'infection', 'injury', 'inn', 'insect', 'inspector', 'instance',
  'instant', 'instruction', 'instrument', 'intelligent', 'interesting', 'internal', 'introduction', 'invention',
  'investment', 'invitation', 'island', 'item',
  'oak', 'oath', 'obligation', 'observation', 'obstacle', 'occasion', 'ocean', 'odd', 'offence', 'office', 'officer',
  'official', 'old', 'omelette', 'onion', 'online', 'only', 'opening', 'opera', 'operation', 'operator', 'opinion',
  'opponent', 'opportunity', 'option', 'oral', 'orange', 'orchestra', 'ordinary', 'organ', 'organisation',
  'organization', 'origin', 'original', 'orphan', 'outcome', 'outdoor', 'outfit', 'oven', 'overview', 'owl', 'owner',
  'ox',
];

/** Lowercase word → the article it takes. */
export const VETTED_ARTICLES: ReadonlyMap<string, 'a' | 'an'> = new Map([
  ...TAKES_A.map((word) => [word, 'a'] as const),
  ...TAKES_AN.map((word) => [word, 'an'] as const),
]);
