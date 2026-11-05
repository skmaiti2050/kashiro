/** The interface names the proofreading language from the engine's capabilities, through the UI's own table (#2b). */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { EngineId } from '@/engine/languageEngine';
import { CheckSession } from '@/engine/session';
import { PROOFREADING_LABELS, proofreadingLabels, type ProofreadingLabels } from '@/ui/proofreadingLabels';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** A looser view of the table, to add a test-only id. */
const table = PROOFREADING_LABELS as Record<string, ProofreadingLabels>;

afterEach(() => {
  vi.restoreAllMocks();
  delete table.test;
});

/** Makes every session report one proofreading engine with this (test-only) id. */
const reportEngine = (id: string) =>
  vi.spyOn(CheckSession.prototype, 'proofreadingEngines').mockReturnValue([
    {
      id: id as EngineId,
      proofreads: true,
      variants: [],
      hasCase: true,
      script: 'Latin',
      language: 'en',
      trust: { zeroClick: true, safeKinds: 'english', ticks: 'slipDoublings' },
    },
  ]);

describe('proofreading labels', () => {
  it('before a check there is no session, and the labels are English', () => {
    expect(proofreadingLabels(null)).toBe(table.en);
  });

  it('an engine with another id and another mapped key changes the toolbar chip', async () => {
    table.test = { ...table.en, chip: 'toolbar.mixedSpelling' };
    reportEngine('test');
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    expect(screen.getByText('Mixed spelling')).toBeTruthy();
    expect(screen.queryByText('English proofreading')).toBeNull();
  });

  it('an id the table lacks never throws: the labels fall back to English', () => {
    const session = { proofreadingEngines: () => [{ id: 'unknown', proofreads: true, variants: [], hasCase: false }] } as unknown as CheckSession;
    expect(proofreadingLabels(session)).toBe(table.en);
  });
});
