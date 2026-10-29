import { describe, it, expect } from 'vitest';
import { createLinter, withArticleCase } from '@/engine/linter';

const para = (text: string, id = 0) => ({ id, text });

describe('createLinter', () => {
  it('reports agreement and grammar candidates with replacements', async () => {
    const l = await createLinter('American');
    const c = await l.lintParagraphs([para('I has went their.')], 'plaintext');
    const agr = c.find((x) => x.kind === 'Agreement');
    const gra = c.find((x) => x.kind === 'Grammar');
    expect(agr?.original).toBe('has');
    expect(agr?.replacements).toEqual(['have']);
    expect(gra?.original).toBe('went');
    expect(gra?.replacements).toEqual(['gone']);
  });

  it('writes an a/an fix in the case of the article it replaces: "A apple" → "An", not "AN" (F4 re-review 3, I-1)', async () => {
    const l = await createLinter('American');
    const fixes = async (text: string) => (await l.lintParagraphs([para(text)], 'plaintext')).filter((c) => c.kind === 'Miscellaneous').map((c) => c.replacements);
    expect(await fixes('A apple fell.')).toEqual([['An']]);
    expect(await fixes('It rained. An banana fell.')).toEqual([['A']]);
    expect(await fixes('We ate a apple.')).toEqual([['an']]);
    expect([withArticleCase('AN', 'a'), withArticleCase('An', 'A'), withArticleCase('an', 'A'), withArticleCase('the', 'THE')]).toEqual(['A', 'A', 'a', 'THE']);
  });

  it('keeps UTF-16 offsets correct after an emoji', async () => {
    const l = await createLinter('American');
    const text = 'Priya said 😀 that their is';
    const c = await l.lintParagraphs([para(text, 7)], 'plaintext');
    const t = c.find((x) => x.original === 'their');
    expect(t).toBeDefined();
    expect(text.slice(t!.span.start, t!.span.end)).toBe('their');
    expect(t!.paraId).toBe(7);
    expect(t!.id).toBe(`7:${t!.span.start}:${t!.span.end}:${t!.kind}`);
    expect(t!.source).toBe('rules');
  });

  it('a repeated paragraph gets the same flags under its own id, with its own copies', async () => {
    const l = await createLinter('American');
    const c = await l.lintParagraphs([para('teh value', 0), para('Fine.', 1), para('teh value', 2)], 'plaintext');
    const [first, second] = c.filter((x) => x.original === 'teh');
    expect([first.id, second.id]).toEqual(['0:0:3:Typo', '2:0:3:Typo']);
    expect(second.replacements).toEqual(first.replacements);
    expect(second.replacements).not.toBe(first.replacements);
    expect(second.span).not.toBe(first.span);
  });

  it('addWords removes the spelling candidate', async () => {
    const l = await createLinter('American');
    const text = 'Sujit went home.';
    const before = await l.lintParagraphs([para(text)], 'plaintext');
    expect(before.some((x) => x.kind === 'Spelling' && x.original === 'Sujit')).toBe(true);
    await l.addWords(['Sujit']);
    const after = await l.lintParagraphs([para(text)], 'plaintext');
    expect(after.some((x) => x.kind === 'Spelling')).toBe(false);
  });

  it('markdown mode ignores inline code', async () => {
    const l = await createLinter('American');
    const c = await l.lintParagraphs([para('Use `teh` here.')], 'markdown');
    expect(c.some((x) => x.original === 'teh')).toBe(false);
  });

  it('setVariant switches dialect', async () => {
    const l = await createLinter('American');
    const text = 'The colour is nice.';
    const us = await l.lintParagraphs([para(text)], 'plaintext');
    expect(us.some((x) => x.original === 'colour')).toBe(true);
    await l.setVariant('British');
    const uk = await l.lintParagraphs([para(text)], 'plaintext');
    expect(uk.some((x) => x.original === 'colour')).toBe(false);
  });

  it('lintSpelling flags only spelling, under the given variant, and leaves the current variant', async () => {
    const l = await createLinter('American');
    await l.addWords(['Sujit']);
    const text = 'Sujit said the colour of teh car is is red.';
    const us = await l.lintSpelling([para(text)], 'American');
    expect(us.map((x) => x.original)).toContain('colour');
    expect(us.some((x) => x.original === 'Sujit' || x.original === 'is is')).toBe(false);
    const uk = await l.lintSpelling([para(text)], 'British');
    expect(uk.some((x) => x.original === 'colour')).toBe(false);
    expect(l.variant).toBe('American');
  });

  it('keeps added words across setVariant', async () => {
    const l = await createLinter('American');
    await l.addWords(['Sujit']);
    await l.setVariant('British');
    await l.setVariant('American');
    const c = await l.lintParagraphs([{ id: 0, text: 'Sujit went home.' }], 'plaintext');
    expect(c.filter((x) => x.kind === 'Spelling')).toHaveLength(0);
  });
});

describe('Indian-English word list', () => {
  it.each(['American', 'British', 'Indian'] as const)('knows common Indian-English words under %s', async (v) => {
    const l = await createLinter(v);
    const text =
      // "gram" is left out of the list on purpose (a typo shape of "ram"; see TYPO_SHAPED below); "dal" stays (DAILY).
      'The sarpanch of the panchayat met the tehsildar about the borewells, the nullah and two lakh rupees. ' +
      'We ate khichdi, roti, poha and theplas at a dhaba near the godown, then preponed the meeting.';
    const spelling = (await l.lintParagraphs([para(text)], 'plaintext')).filter((x) => x.kind === 'Spelling' || x.kind === 'Typo');
    expect(spelling.map((x) => x.original)).toEqual([]);
  });

  it('still flags real misspellings', async () => {
    const l = await createLinter('Indian');
    const c = await l.lintParagraphs([para('The goverment recieved it.')], 'plaintext');
    expect(c.map((x) => x.original)).toEqual(expect.arrayContaining(['goverment', 'recieved']));
  });
});

describe('TECH_WORDS list', () => {
  it('is a plain sorted list of at most 150 unique lowercase words', async () => {
    const { TECH_WORDS } = await import('@/engine/wordlists/tech');
    expect(TECH_WORDS.length).toBeGreaterThanOrEqual(50);
    expect(TECH_WORDS.length).toBeLessThanOrEqual(150);
    expect(new Set(TECH_WORDS).size).toBe(TECH_WORDS.length);
    expect([...TECH_WORDS].sort()).toEqual(TECH_WORDS);
    for (const w of TECH_WORDS) expect(w).toMatch(/^\p{Ll}[\p{Ll}\p{N}]*$/u);
  });

  it.each(['American', 'British'] as const)('lowercase tech words are not flagged (%s)', async (variant) => {
    const l = await createLinter(variant);
    const text = 'The ai and api need a json url, a pdf or csv, a wireframe, a dropdown, the frontend and backend, a login, signup and onboarding workflow, a dataset with a timestamp, the codebase and devops.';
    const c = await l.lintParagraphs([para(text)], 'plaintext');
    expect(c.filter((x) => x.kind === 'Spelling' || x.kind === 'Typo').map((x) => x.original)).toEqual([]);
  });

  it('lowercase word+digit identifiers are not flagged (html5, python3, k8s…)', async () => {
    const l = await createLinter('Indian');
    const ids = 'html5 http2 http3 base64 python3 oauth2 k8s l10n a11y i18n utf8 mp3 mp4 h264 ipv4 ipv6 es6 win32 x86 x64 arm64 md5 sha256 web3';
    const text = ids.split(' ').map((w) => `We use ${w} here.`).join(' ');
    const c = await l.lintParagraphs([para(text)], 'plaintext');
    expect(c.filter((x) => x.kind === 'Spelling' || x.kind === 'Typo').map((x) => x.original)).toEqual([]);
  });
});

describe('TECHNICAL_WORDS list (Task F21 item F: command and cloud words, "su → so")', () => {
  it('is a plain sorted list of at most 200 unique lowercase words, none already in TECH_WORDS', async () => {
    const { TECHNICAL_WORDS } = await import('@/engine/wordlists/technical');
    const { TECH_WORDS } = await import('@/engine/wordlists/tech');
    expect(TECHNICAL_WORDS.length).toBeLessThanOrEqual(200);
    expect(new Set(TECHNICAL_WORDS).size).toBe(TECHNICAL_WORDS.length);
    expect([...TECHNICAL_WORDS].sort()).toEqual(TECHNICAL_WORDS);
    for (const w of TECHNICAL_WORDS) expect(w).toMatch(/^\p{Ll}[\p{Ll}\p{N}]*$/u);
    expect(TECHNICAL_WORDS.filter((w) => TECH_WORDS.includes(w))).toEqual([]);
  });

  it('each entry is one Harper flags as a misspelling on its own', async () => {
    const { TECHNICAL_WORDS } = await import('@/engine/wordlists/technical');
    const { LocalLinter, Dialect } = await import('harper.js');
    const { binaryInlined } = await import('harper.js/binaryInlined');
    const harper = new LocalLinter({ binary: binaryInlined, dialect: Dialect.Indian });
    await harper.setup();
    const unflagged: string[] = [];
    for (const word of TECHNICAL_WORDS) {
      const lints = await harper.lint(`We use ${word} here.`, { language: 'plaintext' });
      const kinds = lints.map((l) => {
        const kind = l.lint_kind();
        l.free();
        return kind;
      });
      if (!kinds.some((k) => k === 'Spelling' || k === 'Typo')) unflagged.push(word);
    }
    expect(unflagged).toEqual([]);
  });

  it.each(['Indian', 'American', 'British'] as const)('none is flagged once loaded (%s): "su → so" is gone', async (variant) => {
    const { TECHNICAL_WORDS } = await import('@/engine/wordlists/technical');
    const l = await createLinter(variant);
    const text = TECHNICAL_WORDS.map((w) => `We use ${w} here.`).join(' ') + ' Scripts use sudo su ubuntu to switch user.';
    const c = await l.lintParagraphs([para(text)], 'plaintext');
    expect(c.filter((x) => x.kind === 'Spelling' || x.kind === 'Typo').map((x) => x.original)).toEqual([]);
  });
});

describe('EN_IN_WORDS list', () => {
  it('is a plain sorted list of 600-800 unique lowercase words', async () => {
    const { EN_IN_WORDS } = await import('@/engine/wordlists/en-IN');
    expect(EN_IN_WORDS.length).toBeGreaterThanOrEqual(600);
    expect(EN_IN_WORDS.length).toBeLessThanOrEqual(800);
    expect(new Set(EN_IN_WORDS).size).toBe(EN_IN_WORDS.length);
    expect([...EN_IN_WORDS].sort()).toEqual(EN_IN_WORDS);
    for (const w of EN_IN_WORDS) expect(w).toMatch(/^\p{Ll}[\p{Ll}-]*$/u);
  });

  // The list loads for every variant, so a short entry that is a typical typo of a common word
  // ("lok" for "look") would hide that typo. Found by the neighbour check in the Task 10 report.
  const TYPO_SHAPED = [
    'aai', 'amti', 'beta', 'bua', 'gram', 'gully', 'gur', 'haat', 'hing', 'lok', 'lota', 'lotas', 'pani',
    'rava', 'safa', 'seekh', 'sev', 'tai', 'taluk', 'teej', 'tur', 'usal', 'zaid',
  ];
  // Daily words an Indian writer uses, kept even though they are one edit from an English word.
  const DAILY = [
    'amma', 'babu', 'chaat', 'chai', 'dal', 'dals', 'eid', 'ghat', 'ghee', 'ji', 'lassi', 'moong', 'neta',
    'paan', 'pav', 'puri', 'roti',
  ];

  it('keeps daily Indian-English words even when they are one edit from an English word', async () => {
    const { EN_IN_WORDS } = await import('@/engine/wordlists/en-IN');
    expect(EN_IN_WORDS).toEqual(expect.arrayContaining(DAILY));
  });

  it('leaves out short words that are typical typos of common English words', async () => {
    const { EN_IN_WORDS } = await import('@/engine/wordlists/en-IN');
    expect(EN_IN_WORDS.filter((w) => TYPO_SHAPED.includes(w))).toEqual([]);
  });

  it('so "lok" for "look" is still flagged', async () => {
    const l = await createLinter('British');
    const c = await l.lintParagraphs([para('I will lok at the pani tomorrow.')], 'plaintext');
    expect(c.map((x) => x.original)).toEqual(expect.arrayContaining(['lok', 'pani']));
  });

  it('lists singular and plural together (chapatti, chapattis; phera, pheras)', async () => {
    const { EN_IN_WORDS } = await import('@/engine/wordlists/en-IN');
    expect(EN_IN_WORDS).toEqual(expect.arrayContaining(['chapatti', 'chapattis', 'phera', 'pheras']));
  });
});
