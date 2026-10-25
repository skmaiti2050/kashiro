/**
 * The never-damage stress test's documents: correct prose built from fixed templates, full of traps the
 * engine must never change on its own (CLAUDE.md rule #1), plus a few planted errors with one approved fix.
 *
 * Template markers:
 * - `[[…]]`  a trap: no automatic change may touch it (an invisible character inside it may be deleted);
 * - `<<wrong|right>>`  a planted error: the one approved automatic change there is `wrong` → `right`;
 * - `{{200B}}`  an invisible character the hygiene rule may delete (U+ hex code).
 * Invisible characters written as `\u{…}` without `{{…}}` are part of the text (a joiner Indic script needs).
 */

/** A paragraph of the generated document, with what the checks need to judge each automatic change. */
export interface StressParagraph {
  text: string;
  /** [start, end) of each trap, in `text`. */
  traps: { start: number; end: number }[];
  /** Planted errors: the span and its one approved replacement. */
  fixes: { start: number; end: number; right: string }[];
  /** Offsets of invisible characters the hygiene rule may delete. */
  junk: Set<number>;
}

/** Correct, plain sentences between the traps. */
const FILLERS = [
  'The team met on Monday to review the plan.',
  'We will share the final numbers next week.',
  'Most of the work is already done.',
  'Please send the form back when you can.',
  'The bus was late again this morning.',
  'Our office opens at nine and closes at six.',
  'She thanked everyone for their patience.',
  'The rain stopped just before noon.',
  'We need two more chairs for the hall.',
  'The children walked home after school.',
  // Two spaces between words: collapsing them is one of the two changes made without a click.
  'The hall was  full by ten.',
];

/** Sentences with traps: legitimate text a careless rule would "fix". */
const TRAPS = [
  // Grammatical doubling (review #4, C1).
  'He [[had had]] enough of the delays.',
  'She knew [[that that]] was the hard part.',
  'What it [[is is]] a question of time.',
  'What it [[was was]] plain bad luck.',
  'Please log [[in in]] the morning.',
  'Turn the pump [[on on]] Monday.',
  'I [[do do]] read every reply.',
  'They served [[hot hot]] pakoras at the stall.',
  'He typed "[[is is]]" by mistake.',
  '“He [[had had]] enough,” she said.',
  // A slip-list word before a word it starts: a hyphen or apostrophe continues it (F3 re-review, D1). The linter
  // flags these only after a paragraph's first sentence, hence the short sentence before each.
  'It rained. He worked [[for for-profit]] colleges.',
  'It rained. Invest [[with with-profits]] funds.',
  'It rained. Notes [[for for-loop]] code.',
  'It rained. They wrote [[and and-gate]] logic.',
  'It rained. Pick [[a a-la-carte]] meal.',
  'It rained. We went [[to to’s]] house.',
  "It rained. We went [[to to's]] house.",
  'It rained. He built [[a lean-to to]] keep dry.',
  // Invisible characters hygiene leaves in place, inside a word after an article (F3 re-review, D2).
  'We saw [[a m\u{200E}ean]] value.',
  'We saw [[a m\u{2066}ean\u{2069}]] value.',
  'We saw [[a m\u{FE0F}ean]] value.',
  'It was [[a m\u{034F}ean]] trick.',
  'It is [[a m\u{2061}ean]] score.',
  'Read [[the te\u{180B}xt]] now.',
  // A direction-control pair with one end in a quote or code span (F3 re-review, D3).
  'He said "[[{{202E}}sales]]" today{{202C}} and left.',
  'Run [[`ls{{202E}} -la`]] now{{202C}} please.',
  // Invisible and bidi characters inside and next to words (review #4, C3).
  'We saw [[a m{{2060}}ean]] value.',
  'We trained the [[mod{{200B}}els]] well.',
  'The [[re{{00AD}}port]] is ready.',
  'The [[{{FEFF}}draft]] is attached.',
  'Read the [[note{{202E}}s]] first.',
  // Any other character after a doubling continues the word too: a slash, plus, dot or hash (F3 re-review 2, C-1).
  'It rained. Avoid mixing [[and and/or]] in one clause.',
  'It rained. Count the votes [[for for/against]] motions.',
  'It rained. Serve tea [[with with/without]] sugar.',
  'It rained. Write [[the the/a]] choice down.',
  'It rained. Pick [[a a+]] grade.',
  'It rained. We code [[for for.NET]] users.',
  'It rained. Tag it [[with with#hash]] now.',
  // A doubling only a Grammar flag touches (F3 re-review 2, I-3).
  'It rained. Let it [[be be-bop]] music.',
  // Articles the user wrote right: joined by a slash, or before a word said with a "you" sound (C-2, C-3).
  'It rained. Use [[a/an]] correctly in every sentence.',
  'It rained. Plug in [[a usb]] drive.',
  'It rained. She is preparing for [[a upsc]] exam.',
  // An abbreviation's full stop is not a sentence end, with or without a mark before it (C-4, I-1).
  'It rained. The [[Govt. of]] India said so.',
  'It rained. He joined Infosys [[Pvt. Ltd. last]] year.',
  'It rained. Bring pens, books [[etc\u{200E}. and]] the rest.',
  'It rained. Use one, [[i.e\u{200E}. the]] best.',
  // Direction pairs around an isolate: the PDI closes the inner embedding, so the last PDF ends the RLO (I-2).
  'Total [[{{202E}}abc \u{2066}x\u{202B}y\u{2069} z{{202C}}]] and the rest is plain.',
  'Total [[{{202E}}abc \u{2068}x\u{202D}y\u{2069} z{{202C}}]] and the rest is plain.',
  // Spaces around a direction control hygiene keeps: a spacing fix must not take the control with it (I-4).
  'He said "[[{{202E}}sales]]" today  {{202C}}  and left.',
  'The [[cost{{180E}}s]] went up.',
  'The [[{{202B}}sales]] rose this year.',
  'The [[sum{{200C}}mary]] is short.',
  'The [[pa{{202A}}per{{202C}}s]] are here.',
  'He said [[a{{200B}}n]] [[apple]] fell.',
  'It was [[an{{200D}}]] [[old]] house.',
  // Acronyms and mixed case.
  'Update the [[SOPs]] before the audit.',
  'My [[iPhone]] needs a new charger.',
  'Complete the [[eKYC]] online.',
  'The [[UPI]] payment failed twice.',
  // Names and places.
  'We met [[Anirban Chatterjee]] at the station.',
  'The trek to [[Kalsubai]] starts early.',
  'Ask [[Mr. D’Souza]] about the bill.',
  'The note from [[Priya Raghunathan]] arrived today.',
  // Numbers and amounts, Devanagari and Bengali digits included.
  'The flat costs [[₹1,25,000]] a year.',
  'The grant is [[Rs 5 lakh]] this time.',
  'Turnover crossed [[3.5 crore]] in [[2024-25]].',
  'Room [[१२३]] is on the left.',
  'The fee is [[৪৫৬]] taka.',
  'The train leaves at [[10:30]] sharp.',
  // Indian English.
  'Can we [[prepone]] the meeting?',
  'He is [[out of station]] till Monday.',
  'My [[cousin-brother]] lives in Pune.',
  // Romanised Indian-language words.
  'We ate [[ukadiche modak]] at home.',
  'That fix was pure [[jugaad]].',
  'We stopped for [[chai]] at the [[dhaba]].',
  // Quotes, URLs, email and code spans.
  'She wrote, “[[The the cat sat]].”',
  'See [[https://example.org/path_to/file?id=12&x=y]] for details.',
  'Visit [[www.example.co.in]] today.',
  'Email [[ops@example.in]] for help.',
  'Copy it to [[\\\\localhost\\C$\\Reports]] first.',
  'Run [[`npm run build`]] before you push.',
  'Use [[`total = total + 1`]] in the loop.',
  // Columns lined up with spaces: preformatted text, whose spaces are layout.
  'Stock today:\n[[Pens    10]]\n[[Ink     25]]',
  // The simple-fixes card's default ticks (F4 re-review 3): "apply all" must not make these.
  // A capital after an abbreviation's dot that no list names (I-2), and "Ph" → "pH" inside "Ph.D.".
  'Meet at 5 [[pm. tomorrow]] please.',
  '[[Jan. was]] cold.',
  '[[Bros. came]] home.',
  '[[Hon. minister]] came.',
  '[[Wt. and]] ht. noted.',
  '[[Qty. ten]] is fine.',
  '[[Amt. due]] is ten.',
  '[[Ave. road]] is long.',
  'It rained today. [[Engg. college]] is near.',
  'It rained today. [[Ph.D.]] students came.',
  'The proof went to the HoD. [[Ph.D.]] scholars wait.',
  'She has a [[Ph.D.]] in physics.',
  // An article before an initialism or a "you" sound (I-3), and two fixes that combine into a wrong pair ("a SMS").
  'It is [[a ewe]] lamb.',
  'Buy [[an lpg]] cylinder.',
  'He is [[an rss]] member.',
  'He got [[an sms]] today.',
  'See [[an hr]] manager.',
  'He is [[an mla]] now.',
  'He is [[an nri]] now.',
  'File [[an fir]] today.',
  // Spaces the zero-click rule refuses as layout are not ticked on the card either (M-4).
  'Use [[tabs\t\there]] please.',
];

/**
 * A key–value block whose lines are paragraphs of their own (F4 re-review 3, M-3): its spaces are layout,
 * like the columns above, even though no one paragraph shows it.
 */
const KEY_VALUE_BLOCK = ['[[Name      Rahul Sharma]]', '[[City      Pune]]', '[[Amount    500]]', '[[Score: India 250  Australia 245]]'];

/** Paragraph openers: list labels the format does not draw itself. */
const LIST_LABELS = ['[[a.]] ', '[[(iv)]] ', '[[1.]] ', '[[b)]] '];

/** Whole paragraphs in Hindi and Bengali, with the joiners (ZWJ, ZWNJ) their scripts need. */
const INDIC = [
  '[[यह एक छोटा सा परीक्षण है। हम कल बाज़ार गए थे।]]',
  '[[आमरा काल बाजारे गियेछिलाम। एटा एकटा छोटो परीक्षा।]]',
  '[[क्\u{200D}ष और क्\u{200C}ष दोनों सही हैं।]]',
  '[[র\u{200D}্যাব আর ক্\u{200C}ষ দুটোই ঠিক।]]',
  '[[আমরা কাল বাজারে গিয়েছিলাম। এটা একটা ছোট পরীক্ষা।]]',
];

/** Planted errors with their one approved automatic fix. */
const PLANTED = [
  'I think <<teh|the>> plan works.',
  'He ate <<a|an>> apple.',
  'We went to <<the the|the>> market.',
  // Harper writes "AN" after a capital "A" (F4 re-review 3, I-1): the one right fix keeps the case.
  '<<A|An>> elephant came.',
];

/** Invisible characters sprinkled at random between ASCII characters. */
const RANDOM_JUNK = [0x200b, 0x2060, 0xfeff, 0x00ad, 0x200c, 0x200d, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x180e];

/** Mulberry32: a small seeded generator, so every run builds the same documents. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One character of a paragraph with its markers. */
interface Char {
  ch: string;
  trap?: number;
  fix?: number;
  right?: string;
  junk?: boolean;
}

/** `[[`, `]]`, `<<wrong|right>>` or `{{hex}}` at the start of `rest`. */
const MARKER = /^(?:\[\[|\]\]|<<([^|]*)\|([^>]*)>>|\{\{([0-9A-F]{4})\}\})/;

let markerIds = 0;

function parseTemplate(template: string): Char[] {
  const out: Char[] = [];
  let trap: number | undefined;
  for (let i = 0; i < template.length; ) {
    const m = MARKER.exec(template.slice(i));
    if (!m) {
      out.push({ ch: template[i], trap });
      i++;
      continue;
    }
    i += m[0].length;
    if (m[0] === '[[') trap = ++markerIds;
    else if (m[0] === ']]') trap = undefined;
    else if (m[3]) out.push({ ch: String.fromCharCode(parseInt(m[3], 16)), trap, junk: true });
    else {
      const fix = ++markerIds;
      for (const ch of m[1]) out.push({ ch, fix, right: m[2] });
    }
  }
  return out;
}

const ASCII_TEXT = /^[A-Za-z ]$/;

/** Inserts one random invisible character between two ASCII letters or spaces; it joins a trap or fix it lands inside. */
function sprinkleJunk(chars: Char[], random: () => number): void {
  const slots: number[] = [];
  for (let i = 1; i < chars.length; i++) if (ASCII_TEXT.test(chars[i - 1].ch) && ASCII_TEXT.test(chars[i].ch)) slots.push(i);
  if (slots.length === 0) return;
  const at = slots[Math.floor(random() * slots.length)];
  const before = chars[at - 1];
  const after = chars[at];
  const ch = String.fromCharCode(RANDOM_JUNK[Math.floor(random() * RANDOM_JUNK.length)]);
  const trap = before.trap === after.trap ? before.trap : undefined;
  const fix = before.fix === after.fix ? before.fix : undefined;
  chars.splice(at, 0, { ch, trap, fix, right: fix === undefined ? undefined : before.right, junk: true });
}

function toParagraph(chars: Char[]): StressParagraph {
  const text = chars.map((c) => c.ch).join('');
  const traps: StressParagraph['traps'] = [];
  const fixes: StressParagraph['fixes'] = [];
  const junk = new Set<number>();
  chars.forEach((c, i) => {
    if (c.junk) junk.add(i);
    if (c.trap !== undefined) {
      const last = traps.at(-1);
      if (last && chars[i - 1]?.trap === c.trap) last.end = i + 1;
      else traps.push({ start: i, end: i + 1 });
    }
    if (c.fix !== undefined) {
      const last = fixes.at(-1);
      if (last && chars[i - 1]?.fix === c.fix) last.end = i + 1;
      else fixes.push({ start: i, end: i + 1, right: c.right! });
    }
  });
  return { text, traps, fixes, junk };
}

/**
 * `count` slots of paragraphs, the same for the same seed: mostly 3–6 sentences mixing traps, fillers and planted
 * errors, some starting with a list label, some wholly Hindi or Bengali, and every 20th a key–value block of
 * one-line paragraphs. Every trap template is used once
 * before any is used twice. About a third of the sentences get a random invisible character.
 */
export function stressDocument(seed: number, count: number): StressParagraph[] {
  const random = seeded(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  // Traps are dealt like cards, so every one appears before any appears twice.
  let trapDeck: string[] = [];
  const nextTrap = () => {
    if (trapDeck.length === 0) trapDeck = [...TRAPS];
    return trapDeck.splice(Math.floor(random() * trapDeck.length), 1)[0];
  };
  const paragraphs: StressParagraph[] = [];
  for (let p = 0; p < count; p++) {
    if (p % 20 === 10) {
      paragraphs.push(...KEY_VALUE_BLOCK.map((line) => toParagraph(parseTemplate(line))));
      continue;
    }
    if (random() < 0.1) {
      paragraphs.push(toParagraph(parseTemplate(pick(INDIC))));
      continue;
    }
    const chars: Char[] = random() < 0.15 ? parseTemplate(pick(LIST_LABELS)) : [];
    const sentences = 3 + Math.floor(random() * 4);
    for (let s = 0; s < sentences; s++) {
      const r = random();
      const sentence = parseTemplate(r < 0.6 ? nextTrap() : r < 0.85 ? pick(FILLERS) : pick(PLANTED));
      if (random() < 0.35) sprinkleJunk(sentence, random);
      if (chars.length > 0 && !/\s$/.test(chars[chars.length - 1].ch)) chars.push({ ch: ' ' });
      chars.push(...sentence);
    }
    paragraphs.push(toParagraph(chars));
  }
  return paragraphs;
}

/** Number of sentences in the documents, for the report: one per sentence end in Latin or Indic script. */
export function sentenceCount(paragraphs: StressParagraph[]): number {
  return paragraphs.reduce((n, p) => n + (p.text.match(/[.?!।](?=[”"]?(\s|$))/g)?.length ?? 0), 0);
}
