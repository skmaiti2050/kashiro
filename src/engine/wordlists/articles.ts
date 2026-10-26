/**
 * The vetted a/an table (Task F6, owner decision 2026-10-26). The simple-fixes card ticks an article swap by
 * default only before one of these words, and only toward the article listed here; every other swap is still
 * offered, unticked. The article follows the word's first *sound*, which its spelling doesn't always tell ("a
 * union", "an uncle", "an hour", "a house", "a one-off"), so the words are listed by hand rather than guessed.
 *
 * To add a word: put it in TAKES_A or TAKES_AN, in lowercase letters only, by how it is said in British, American
 * and Indian English alike. Leave it out when you aren't certain of its first sound in all three: most u-, eu-,
 * ew-, on- and h- words need that thought ("herb", "historic", "homage", "humble", "hotel" are left out on
 * purpose), and no abbreviation or initialism belongs here ("usb", "mla", "fir", "hr"). tests/engine/articles.test.ts
 * checks a sample and that each vowel-letter word in TAKES_A, or consonant-letter word in TAKES_AN, is one it knows.
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

/** Words said with a vowel sound first: "an" goes before them. */
export const TAKES_AN = [
  // A silent "h".
  'heir', 'heiress', 'honest', 'honor', 'honorable', 'honorary', 'honour', 'honourable', 'hour', 'hourly',
  // A "u" said as in "up" or "urge", not "you".
  'ugly', 'umbrella', 'umpire', 'unclear', 'uncle', 'underdog', 'underground', 'understanding', 'undertaking',
  'unexpected', 'unfair', 'unfinished', 'unfortunate', 'unhappy', 'unhealthy', 'unidentified', 'unknown',
  'unlikely', 'unofficial', 'unpaid', 'unpleasant', 'unpopular', 'unsafe', 'unusual', 'unwanted', 'update',
  'upgrade', 'uphill', 'upper', 'upset', 'upward', 'urchin', 'urgent', 'usher', 'utmost', 'utter',
  // Other vowels.
  'able', 'absence', 'absolute', 'abstract', 'academic', 'academy', 'accent', 'access', 'accident', 'account',
  'accountant', 'achievement', 'acid', 'act', 'action', 'active', 'activity', 'actor', 'actress', 'address', 'adult',
  'advantage', 'adventure', 'advertisement', 'affair', 'agency', 'agent', 'agreement', 'aim', 'airline', 'airport',
  'alarm', 'album', 'alert', 'alien', 'alley', 'alliance', 'amount', 'analysis', 'ancient', 'angel', 'angle',
  'angry', 'animal', 'ankle', 'announcement', 'answer', 'ant', 'apartment', 'apology', 'app', 'apple', 'application',
  'appointment', 'approach', 'apron', 'architect', 'area', 'argument', 'arm', 'army', 'arrangement', 'arrow', 'art',
  'article', 'artist', 'aspect', 'assembly', 'assessment', 'asset', 'assignment', 'assistant', 'athlete',
  'attack', 'attempt', 'attitude', 'audience', 'audit', 'audition', 'author', 'average', 'award', 'awful', 'axe',
  'eagle', 'ear', 'early', 'earring', 'earthquake', 'easy', 'echo', 'edge', 'edition', 'editor', 'effect', 'effort',
  'egg', 'eight', 'eighteen', 'eighty', 'elbow', 'election', 'electrician', 'element', 'elephant', 'elevator',
  'email', 'embassy', 'emergency', 'emotion', 'empire', 'employee', 'employer', 'empty', 'end', 'enemy', 'engine',
  'engineer', 'entry', 'envelope', 'episode', 'equal', 'error', 'escape', 'essay', 'estate', 'estimate', 'evening',
  'event', 'exam', 'example', 'excellent', 'exception', 'excuse', 'exercise', 'exhibition', 'exit', 'expert',
  'explanation', 'extension', 'extra', 'eye',
  'icon', 'idea', 'ideal', 'identity', 'igloo', 'illness', 'image', 'impact', 'important', 'impression',
  'improvement', 'inch', 'incident', 'income', 'increase', 'index', 'individual', 'industry', 'infant', 'infection',
  'influence', 'initial', 'injury', 'ink', 'inn', 'insect', 'inspector', 'instance', 'instant', 'institute',
  'instruction', 'instrument', 'insult', 'intelligent', 'interest', 'interesting', 'internal', 'interview',
  'introduction', 'invention', 'investment', 'invitation', 'iron', 'island', 'issue', 'item',
  'oak', 'oath', 'object', 'obligation', 'observation', 'obstacle', 'occasion', 'ocean', 'odd', 'offence', 'offer',
  'office', 'officer', 'official', 'oil', 'old', 'omelette', 'onion', 'online', 'only', 'open', 'opening', 'opera',
  'operation', 'operator', 'opinion', 'opponent', 'opportunity', 'option', 'oral', 'orange', 'orchestra', 'order',
  'ordinary', 'organ', 'organisation', 'organization', 'origin', 'original', 'orphan', 'outcome', 'outdoor',
  'outfit', 'outline', 'oven', 'overview', 'owl', 'owner', 'ox',
];

/** Lowercase word → the article it takes. */
export const VETTED_ARTICLES: ReadonlyMap<string, 'a' | 'an'> = new Map([
  ...TAKES_A.map((word) => [word, 'a'] as const),
  ...TAKES_AN.map((word) => [word, 'an'] as const),
]);
