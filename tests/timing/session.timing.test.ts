// Timing tests run in their own vitest project, one file at a time after the other tests (vitest.config.ts):
// under the full suite's parallel load, wall time stretches several times and would flake them.
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { Paragraph } from '@/engine/types';

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
});
