import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { createLinter } from '@/engine/linter';
import { adapterFor } from '@/formats/registry';
import type { FormatAdapter } from '@/formats/types';
import type { Files } from '@/ui/state/saveFlow';
import { SessionController } from '@/ui/state/sessionController';
import { defaultSettings } from '@/ui/state/settings';
import { noFiles, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** A text adapter that refuses the first edit, as the .docx writer does for text it cannot place safely. */
const refusingFirstEdit: FormatAdapter = {
  ...adapterFor('a.txt')!,
  async write(handle, edits, mode) {
    const [first, ...rest] = edits;
    const out = await adapterFor('a.txt')!.write(handle, rest, mode);
    return { bytes: out.bytes, unplaceable: [{ edit: first, reason: 'crosses a field' }] };
  },
};

const previewOpen = () => reviewPanel().querySelector('.batch-preview') !== null;

// Issue #35: a save marks an edit unplaceable (and may give back the edits it superseded) without a change to the
// text that the open preview could notice, so a preview opened before the save stayed open on stale members.
describe('a save that makes an edit unplaceable closes an open preview (#35)', () => {
  /** Opens a two-batch document, accepts the first batch and opens the preview of the other card. */
  async function withOpenPreview(files: Files) {
    const controller = new SessionController({
      files,
      adapterFor: () => refusingFirstEdit,
      createLinter: (variant, words) => createLinter(variant, words),
      saveSettings: async () => {},
      settings: { ...defaultSettings('en-US'), preset: 'blog' },
    });
    renderShell(controller);
    await openAndWait(controller, () => controller.openText('I recieve mail. You recieve calls.\n\nThe seperate room. A seperate door.'));
    const cards = controller.getState().session!.decisions();
    const batches = [...cards.top, ...cards.more].filter((d) => d.kind === 'batch');
    expect(batches.length).toBeGreaterThanOrEqual(2);
    act(() => controller.accept(batches[0].id));

    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    expect(previewOpen()).toBe(true);
    return controller;
  }

  it('the preview of another card closes', async () => {
    const controller = await withOpenPreview(noFiles);
    await act(async () => {
      await controller.save();
    });
    const session = controller.getState().session!;
    expect(session.outcomes().some((o) => o.unplaceable !== undefined)).toBe(true);
    expect(previewOpen()).toBe(false);
  });

  it('the preview closes even when the write then fails, and the error is still shown', async () => {
    const controller = await withOpenPreview({ ...noFiles, save: async () => Promise.reject(new Error('disk full')) });
    await act(async () => {
      await controller.save();
    });
    const { session, error } = controller.getState();
    expect(session!.outcomes().some((o) => o.unplaceable !== undefined)).toBe(true);
    expect(error).not.toBeNull();
    expect(previewOpen()).toBe(false);
  });
});
