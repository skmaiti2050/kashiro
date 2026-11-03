// Timing tests run in their own vitest project, one file at a time after the other tests (vitest.config.ts):
// under the full suite's parallel load, wall time stretches several times and would flake them.
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { Paragraph } from '@/engine/types';
import { markdownAdapter } from '@/formats/text';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('American');
});

const OPTIONS: CheckOptions = { preset: 'business', fallbackVariant: 'British', language: 'plaintext', dictionary: [] };

const PARAGRAPHS = [
  'The committee met on Tuesday to review the proposal for the new community library. Members discussed the budget, the timeline and the location, which has been a point of contention for several months. Some residents argued that the old post office building should be converted, while others preferred a new site closer to the school. After a long debate, the chair asked for a written report from each side before the next meeting.',
  'Our team has spent the last quarter improving the onboarding process for new customers. We interviewed twenty users, mapped every step they take in the first week, and found that most of them get stuck when connecting their bank account. The fix was simple: we moved the step later in the flow and added a short explanation of why it matters. Since the change, completion rates have risen steadily and support tickets have dropped.',
  'When I first moved to the city, I found it hard to make friends. Everyone seemed busy, and the neighbours rarely said more than a quick hello. Things changed when I joined a running club that met every Saturday morning near the river. Within a month I knew most of the regulars by name, and we often had breakfast together after the run. I still think it was the best decision I made that year.',
  'Climate scientists have long warned that rising temperatures will change rainfall patterns across the region. Farmers are already noticing that the monsoon arrives later and leaves earlier than it used to. Many have started planting different crops, investing in drip irrigation and storing water in small ponds. These changes cost money, however, and smaller farms often cannot afford them without help from the government or local cooperatives.',
  'The recipe looks complicated, but it is easier than it seems. Start by soaking the lentils overnight, then cook them slowly with onions, garlic and a little ginger. Add the tomatoes once the lentils are soft, and let everything simmer for another twenty minutes. Season with salt, cumin and fresh coriander just before serving. It tastes even better the next day, so make a large batch and keep the rest in the fridge.',
];

describe('performance', () => {
  it('a second start on ~1,500 words completes in < 300 ms', async () => {
    const paras: Paragraph[] = [];
    for (let r = 0; r < 4; r++) PARAGRAPHS.forEach((text) => paras.push({ id: paras.length, text }));
    const words = paras.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
    expect(words).toBeGreaterThanOrEqual(1400);

    await CheckSession.start(paras, OPTIONS, { linter }); // warm-up
    const t0 = performance.now();
    await CheckSession.start(paras, OPTIONS, { linter });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300);
  });

  it('building the decisions of a ~1,500-word check stays well under the budget (terms card included)', async () => {
    const paras: Paragraph[] = [];
    for (let r = 0; r < 4; r++) PARAGRAPHS.forEach((text) => paras.push({ id: paras.length, text: `${text} The plasmodium and culicifacies.` }));
    const s = await CheckSession.start(paras, OPTIONS, { linter });
    const t0 = performance.now();
    s.decisions();
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('with romanised Indian-language words: the rules pass (words classified) stays < 300 ms, the decisions < 150 ms', async () => {
    const hinglish =
      ' Accha, chalo, the food was khub bhalo and nahi too spicy, kya baat, bahut paisa and jaldi service.' +
      ' It was romba nalla, chala bagundi, tusi changa and majama too.';
    const paras: Paragraph[] = [];
    for (let r = 0; r < 4; r++) PARAGRAPHS.forEach((text) => paras.push({ id: paras.length, text: text + hinglish }));
    await CheckSession.start(paras, OPTIONS, { linter }); // warm-up: the linter, and the romanised model loads once
    const t0 = performance.now();
    const s = await CheckSession.start(paras, OPTIONS, { linter });
    const rulesMs = performance.now() - t0;
    const t1 = performance.now();
    const { top, more } = s.decisions();
    const decisionsMs = performance.now() - t1;
    expect([...top, ...more].some((d) => d.kind === 'otherLanguage')).toBe(true);
    expect({ rulesMs: rulesMs < 300, decisionsMs: decisionsMs < 150 }).toEqual({ rulesMs: true, decisionsMs: true });
  });

  // Task F21d (F21c adversarial review I-4): Harper took 102 s on 1,500 words with one 20,000-character key in them,
  // and 44 s on a Markdown file with a 10,000-character data URI. A whitespace-free run longer than 200 characters
  // is no longer sent to it, so the check keeps the 300 ms budget.
  /** `length` characters from `alphabet` in a fixed pseudo-random order (a short repeating pattern is fast in Harper). */
  const token = (alphabet: string, length: number) => {
    let x = 12345;
    return Array.from({ length }, () => alphabet[(x = (x * 1103515245 + 12345) % 2 ** 31) % alphabet.length]).join('');
  };
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  it.each([
    ['plain text, a 20,000-character key', 'plaintext', `Key: ${token(BASE64 + '-_', 20_000)}`],
    ['Markdown, a 10,000-character data URI', 'markdown', `![logo](data:image/png;base64,${token(BASE64 + '+/', 10_000)})`],
  ] as const)('~1,500 words with one long token (%s) complete in < 300 ms', async (_name, language, long) => {
    const paras: Paragraph[] = [];
    for (let r = 0; r < 4; r++) PARAGRAPHS.forEach((text) => paras.push({ id: paras.length, text }));
    paras.splice(10, 0, { id: paras.length, text: long });
    const options = { ...OPTIONS, language };
    await CheckSession.start(paras, options, { linter }); // warm-up
    const t0 = performance.now();
    await CheckSession.start(paras, options, { linter });
    expect(performance.now() - t0).toBeLessThan(300);
  }, 600_000);

  // Task U3 fix 1: as one paragraph this table took 30-43 s (the linter's time grows with the square of the flags
  // in a paragraph). Each cell is now its own paragraph and a repeated cell is linted once: ~10 s alone on the dev
  // PC. It still runs on the window's thread; moving the check to a Worker is deferred.
  // The budget is relative (time per row against a 200-row table), so a slower or busy machine still passes (#32);
  // growth with the square of the rows would reach 2.5x at 500 rows and 10x at 2,000.
  const tableOf = async (rows: number) => {
    const row = (i: number) => `| ${i} | Kumarsamy Venkataraghavan | INV-${i}x | teh recieved ammount |`;
    const table = ['| No | Name | Invoice | Note |', '|---|---|---|---|', ...Array.from({ length: rows }, (_, i) => row(i))].join('\n');
    return (await markdownAdapter.read(new TextEncoder().encode(table))).paras;
  };
  it("a flag-heavy Markdown table's time per row stays flat from 200 to 2,000 rows (no square-of-rows growth)", async () => {
    const options = { ...OPTIONS, language: 'markdown' } as const;
    await CheckSession.start(await tableOf(200), options, { linter }); // warm-up, discarded

    const perRow: Record<number, number> = {};
    let last: CheckSession | undefined;
    for (const rows of [200, 500, 1000, 2000]) {
      const paras = await tableOf(rows);
      const t0 = performance.now();
      last = await CheckSession.start(paras, options, { linter });
      perRow[rows] = (performance.now() - t0) / rows;
    }
    expect(last?.candidates().length).toBeGreaterThan(10_000);

    const ratio = (rows: number) => perRow[rows] / perRow[200];
    expect({ 500: ratio(500) < 2.5, 1000: ratio(1000) < 2.5, 2000: ratio(2000) < 2.5 }).toEqual({ 500: true, 1000: true, 2000: true });
  }, 120_000);
});
