/** The interface names the proofreading language from the engine's capabilities, through the UI's own table (#2b). */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { createEnglishEngine } from '@/engine/englishEngine';
import { notCheckedEngine } from '@/engine/notCheckedEngine';
import { CheckSession } from '@/engine/session';
import { PROOFREADING_LABELS, proofreadingLabels, type ProofreadingLabels } from '@/ui/proofreadingLabels';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const table = PROOFREADING_LABELS as Record<string, ProofreadingLabels>;

afterEach(() => {
  vi.restoreAllMocks();
  delete table.test;
});

describe('proofreading labels', () => {
  it('every proofreading engine the app constructs has a row, and the not-checked engine needs none', () => {
    const constructed = [createEnglishEngine(), notCheckedEngine];
    for (const engine of constructed.filter((e) => e.capabilities.proofreads)) {
      expect(table[engine.capabilities.id], engine.capabilities.id).toBeDefined();
    }
    expect(notCheckedEngine.capabilities.proofreads).toBe(false);
  });

  it('before a check there is no session, and the labels are English', () => {
    expect(proofreadingLabels(null)).toBe(table.en);
  });

  it('an engine with another id and another mapped key changes the toolbar chip', async () => {
    table.test = { ...table.en, chip: 'toolbar.mixedSpelling' };
    vi.spyOn(CheckSession.prototype, 'proofreadingEngines').mockReturnValue([{ id: 'test', proofreads: true, variants: [], hasCase: true }]);
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('The cat sat on the mat.'));
    expect(screen.getByText('Mixed spelling')).toBeTruthy();
    expect(screen.queryByText('English proofreading')).toBeNull();
  });

  it('an id with no row says so', () => {
    const session = { proofreadingEngines: () => [{ id: 'zz', proofreads: true, variants: [], hasCase: false }] } as unknown as CheckSession;
    expect(() => proofreadingLabels(session)).toThrow(/zz/);
  });
});
