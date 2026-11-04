/** A document the Hindi engine proofreads is worded as Hindi proofreading (#1 gates 2, 3, 7, 8). */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { EngineId, LanguageEngine } from '@/engine/languageEngine';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';
import { english } from '../ui/english';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** A Hindi engine that finds nothing. */
const fakeHindi: LanguageEngine = {
  capabilities: { id: 'hi' as EngineId, proofreads: true, variants: ['Standard'], hasCase: false },
  check: async () => ({ found: [], uncheckedParagraphs: [] }),
  addWords: async () => {},
};

const HINDI = 'यह एक छोटा सा परीक्षण है। हम कल बाज़ार गए थे।';
const MOSTLY_HINDI = `${HINDI}\n\n${HINDI}\n\n${HINDI}\n\nThe cat sat on the mat.`;

async function openHindi() {
  const { controller } = makeController({}, undefined, undefined, undefined, new Map([['Devanagari', fakeHindi]]));
  renderShell(controller);
  await openAndWait(controller, () => controller.openText(MOSTLY_HINDI));
  return controller;
}

describe('a document the Hindi engine proofreads', () => {
  it('the panel names Hindi', async () => {
    await openHindi();
    const panel = within(reviewPanel());
    expect(panel.getByText('All clear in the Hindi text')).toBeTruthy();
    expect(panel.getByText("1 paragraph isn't in Hindi and was not checked.")).toBeTruthy();
    expect(panel.queryByText('Kashiro proofreads English. Text in other scripts is shown but not checked.')).toBeNull();
    expect(panel.queryByText('Nothing to check: no English words')).toBeNull();
  });

  it('the toolbar chip says Hindi proofreading', async () => {
    await openHindi();
    expect(screen.getByText('Hindi proofreading')).toBeTruthy();
    expect(screen.queryByText('English proofreading')).toBeNull();
  });

  it('the completion announcement names Hindi', async () => {
    const controller = await openHindi();
    // One English paragraph was set aside, so the whole-paragraph branch is reached.
    expect(english(controller.getState().announcement!.message)).toBe(
      'Check finished: nothing to decide. Kashiro proofreads Hindi in this document. Text in other scripts was not checked.',
    );
  });
});

describe('an English document', () => {
  it('with one Hindi paragraph keeps today\'s wording', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(`The cat sat on the mat.\n\nWe met on Monday.\n\n${HINDI}`));
    const panel = within(reviewPanel());
    expect(panel.getByText("1 paragraph isn't in English and was not checked.")).toBeTruthy();
    expect(screen.getByText('English proofreading')).toBeTruthy();
  });
});
