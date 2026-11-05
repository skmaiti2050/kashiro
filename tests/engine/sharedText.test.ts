import { describe, it, expect, beforeAll } from 'vitest';
import { findSharedText } from '@/engine/sharedText';
import { findLockedText } from '@/engine/lockedText';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { CheckOptions } from '@/engine/sessionTypes';
import type { Paragraph } from '@/engine/types';

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

describe('findSharedText', () => {
  // English, Hindi with a URL and a zero-width space, and a fenced code block over two paragraphs.
  const HINDI = `कृपया इस पते पर जाएँ https://example.com और${ZERO_WIDTH_SPACE}फिर फ़ॉर्म भरें।`;
  const DOCUMENT: Paragraph[] = [
    { id: 0, text: 'Run the installer first.' },
    { id: 1, text: HINDI },
    { id: 2, text: '```\nnpm  install kashiro' },
    { id: 3, text: 'npm  run build\n```' },
  ];

  // The English engine checks paragraphs 0, 2 and 3; the Hindi one is set aside.
  const ENGLISH_IDS = new Set([0, 2, 3]);

  it('locks the URL in the Hindi paragraph, and code fenced across two paragraphs in both of them', () => {
    const shared = findSharedText(DOCUMENT, 'markdown', ENGLISH_IDS);
    expect(shared.locked.get(1)).toContainEqual({ start: HINDI.indexOf('https'), end: HINDI.indexOf(' और') });
    // Paragraph 3 alone has no opening fence: only a pass over the whole document knows its first line is code.
    const continued = { start: 0, end: 'npm  run build'.length };
    expect(shared.locked.get(3)).toEqual([continued]);
    expect(shared.commands.surely.get(3)).toEqual([continued]);
    expect(shared.locked.get(0)).toEqual([]);
  });

  it('finds the zero-width space in the Hindi paragraph', () => {
    const shared = findSharedText(DOCUMENT, 'markdown', ENGLISH_IDS);
    const at = HINDI.indexOf(ZERO_WIDTH_SPACE);
    expect(shared.invisible.get(1)!.map((c) => [c.id, c.replacements])).toEqual([[`1:${at}:${at + 1}:Invisible`, ['']]]);
    expect(shared.invisible.get(0)).toEqual([]);
  });
});

describe('English locks read only English paragraphs (owner 2026-11-06)', () => {
  const opts: CheckOptions = { preset: 'business', variant: 'Indian', fallbackVariant: 'Indian', language: 'markdown', dictionary: [] };

  it('a set-aside paragraph between a continued command and its next line does not break the continuation', () => {
    const paras: Paragraph[] = [
      { id: 0, text: 'run.sh \\' },
      { id: 1, text: 'Привет мир' },
      { id: 2, text: 'deploy --all' },
    ];
    const shared = findSharedText(paras, opts.language, new Set([0, 2]));
    const continued = { start: 0, end: 'deploy --all'.length };
    expect(shared.locked.get(2)).toContainEqual(continued);
    expect(shared.commands.surely.get(2)).toContainEqual(continued);
  });

  it('the session locks the continued line too, so its double space is hidden and never fixed', async () => {
    const linter = await createLinter('Indian');
    const paras: Paragraph[] = [
      { id: 0, text: 'run.sh \\' },
      { id: 1, text: 'Привет мир, как дела сегодня?' },
      { id: 2, text: 'deploy  --all' },
    ];
    const s = await CheckSession.start(paras, opts, { linter });
    expect(s.tier('2:6:8:Formatting')).toBe('hidden');
    expect(s.outputText(2)).toBe('deploy  --all');
  });

  it('a set-aside paragraph inside an English fenced block: same locks as an English-only reading', () => {
    const english: Paragraph[] = [
      { id: 0, text: 'Run these commands:\n```\nnpm  install kashiro' },
      { id: 2, text: 'npm  run build\n```\nThen open the app.' },
    ];
    const setAside: Paragraph = { id: 1, text: 'Привет мир' };
    const shared = findSharedText([english[0], setAside, english[1]], opts.language, new Set([0, 2]));
    const englishOnly = findLockedText(english, opts.language);
    for (const p of english) {
      expect(shared.locked.get(p.id)).toEqual(englishOnly.locked.get(p.id));
      expect(shared.commands.surely.get(p.id)).toEqual(englishOnly.commands.surely.get(p.id));
      expect(shared.commands.maybe.get(p.id)).toEqual(englishOnly.commands.maybe.get(p.id));
    }
    expect(shared.locked.get(1)).toEqual(findLockedText([setAside], opts.language).locked.get(1));
  });
});

describe('English output with the shared pass (review focus 4)', () => {
  let linter: RulesLinter;
  beforeAll(async () => {
    linter = await createLinter('Indian');
  });

  const opts: CheckOptions = { preset: 'business', variant: 'Indian', fallbackVariant: 'Indian', language: 'markdown', dictionary: [] };

  // A set-aside Bengali paragraph, a fenced code block over two paragraphs, a double space, a typo and invisible characters.
  const DOCUMENT: Paragraph[] = [
    { id: 0, text: `We met  on teh Monday to${ZERO_WIDTH_SPACE} review the plan.` },
    { id: 1, text: 'আমরা কাল বাজারে  গিয়েছিলাম।' },
    { id: 2, text: 'To set it up, run these commands:\n```\nnpm  install kashiro' },
    { id: 3, text: 'npm run  build\n```' },
    { id: 4, text: `Then open the${BYTE_ORDER_MARK} app and recieve the  report.` },
  ];

  it('gives the same candidates, tiers and outcomes as before', async () => {
    const s = await CheckSession.start(DOCUMENT, opts, { linter });
    const rows = s.outcomes().map((o) => [o.candidate.id, s.tier(o.candidate.id), o.status, o.auto]);
    expect(rows).toMatchInlineSnapshot(`
      [
        [
          "0:6:8:Formatting",
          "safe",
          "applied",
          true,
        ],
        [
          "0:11:14:Typo",
          "batch",
          "pending",
          false,
        ],
        [
          "0:24:25:Invisible",
          "safe",
          "applied",
          true,
        ],
        [
          "3:7:9:Formatting",
          "hidden",
          "pending",
          false,
        ],
        [
          "4:13:14:Invisible",
          "safe",
          "applied",
          true,
        ],
        [
          "4:23:30:Spelling",
          "review",
          "pending",
          false,
        ],
        [
          "4:34:36:Formatting",
          "safe",
          "applied",
          true,
        ],
      ]
    `);
    expect(DOCUMENT.map((p) => s.outputText(p.id))).toMatchInlineSnapshot(`
      [
        "We met on teh Monday to review the plan.",
        "আমরা কাল বাজারে  গিয়েছিলাম।",
        "To set it up, run these commands:
      \`\`\`
      npm  install kashiro",
        "npm run  build
      \`\`\`",
        "Then open the app and recieve the report.",
      ]
    `);
  });
});
