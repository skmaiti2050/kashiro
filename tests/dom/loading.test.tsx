/**
 * Opening and checking are visible (Task U3 item 2): the document area says "Opening…" then "Checking…",
 * the panel too, and the screen reader hears "Checking document…" and then the result.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { SessionController } from '@/ui/state/sessionController';
import { defaultSettings } from '@/ui/state/settings';
import { noFiles } from './harness';
import { renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

let real: RulesLinter;
beforeAll(async () => {
  real = await createLinter('American');
});

/** A controller whose checks wait until `release()` is called. */
function gatedController() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const linter: RulesLinter = {
    get variant() {
      return real.variant;
    },
    lintParagraphs: async (paras, language) => {
      await gate;
      return real.lintParagraphs(paras, language);
    },
    lintSpelling: (paras, v) => real.lintSpelling(paras, v),
    addWords: (w) => real.addWords(w),
    setVariant: (v) => real.setVariant(v),
  };
  const controller = new SessionController({
    files: noFiles,
    createLinter: async () => linter,
    saveSettings: async () => {},
    settings: defaultSettings('en-US'),
  });
  return { controller, release };
}

const announcements = () => screen.getAllByRole('status').map((s) => s.textContent ?? '').join(' | ');

describe('opening and checking', () => {
  it('the controller reports the file being opened until it is read', async () => {
    const { controller, release } = gatedController();
    const seen: (string | null)[] = [];
    controller.subscribe(() => seen.push(controller.getState().opening));
    release();
    await controller.openFile({ name: 'note.txt', path: '/docs/note.txt', bytes: new TextEncoder().encode('I think teh cat is here.') });
    expect(seen[0]).toBe('note.txt');
    expect(controller.getState().opening).toBeNull();
  });

  it('a file that fails to open leaves no "Opening…" behind', async () => {
    const { controller } = gatedController();
    await controller.openFile({ name: 'bad.docx', path: '/docs/bad.docx', bytes: new TextEncoder().encode('not a zip') });
    expect(controller.getState().opening).toBeNull();
  });

  it('while the first check runs, the document area and the panel say "Checking…", and the screen reader hears it', async () => {
    const { controller, release } = gatedController();
    renderShell(controller);
    let opened: Promise<void> = Promise.resolve();
    await act(async () => {
      opened = controller.openText('I think the  cat is here.');
    });
    const documentArea = screen.getByRole('region', { name: 'Untitled.txt' });
    expect(within(documentArea).getByText('Checking…')).toBeTruthy();
    expect(within(screen.getByRole('complementary')).getByText('Checking…')).toBeTruthy();
    expect(announcements()).toContain('Checking document…');

    await act(async () => {
      release();
      await opened;
    });
    await waitFor(() => expect(controller.getState().phase).toBe('ready'));
    expect(within(documentArea).queryByText('Checking…')).toBeNull();
    // The two spaces are collapsed without a click (Task F4), so nothing is left to decide.
    expect(announcements()).toContain('Check finished: nothing to decide.');
  });

  it('the busy line has no animation when the user prefers reduced motion', async () => {
    const css = (await import('node:fs')).readFileSync('src/ui/app.css', 'utf8');
    expect(css).toMatch(/\.busy::after\s*\{[^}]*animation:/);
    // The app-wide rule stops every animation, the busy line's included.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*::before,\s*::after\s*\{\s*animation: none !important;/);
  });
});
