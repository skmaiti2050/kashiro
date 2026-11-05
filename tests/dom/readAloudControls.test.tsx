/**
 * Read aloud can be paused, resumed and stopped (Task U3 item 3): buttons while it reads, Alt+K and Alt+X,
 * and it stops when another document opens.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { makeController, warmLinter } from './harness';
import { installSpeech, LOCAL_VOICE, openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

async function readingSample() {
  const speech = installSpeech([LOCAL_VOICE]);
  const { controller } = makeController();
  renderShell(controller);
  await openAndWait(controller, () => controller.openSample());
  const bar = await within(reviewPanel()).findByRole('group', { name: 'Read aloud' });
  return { speech, controller, bar };
}

describe('read aloud: pause, resume, stop', () => {
  it('Pause and Stop show only while reading; Pause becomes Resume', async () => {
    const { speech, bar } = await readingSample();
    try {
      expect(within(bar).queryByRole('button', { name: /Pause/ })).toBeNull();
      fireEvent.click(within(bar).getByRole('button', { name: /Sentence/ }));
      fireEvent.click(await within(bar).findByRole('button', { name: /Pause/ }));
      expect(speech.synth.paused).toBe(true);
      fireEvent.click(within(bar).getByRole('button', { name: /Resume/ }));
      expect(speech.synth.paused).toBe(false);
      act(() => speech.synth.finish());
      expect(within(bar).queryByRole('button', { name: /Pause|Resume|Stop/ })).toBeNull();
    } finally {
      speech.remove();
    }
  });

  it('Alt+K pauses and resumes; Alt+X stops, even while paused', async () => {
    const { speech, bar } = await readingSample();
    try {
      fireEvent.keyDown(document.body, { key: 's', altKey: true });
      expect(speech.synth.speaking).toBe(true);
      fireEvent.keyDown(document.body, { key: 'k', altKey: true });
      expect(speech.synth.paused).toBe(true);
      const stops = speech.synth.cancelled;
      fireEvent.keyDown(document.body, { key: 'x', altKey: true });
      expect(speech.synth.cancelled).toBe(stops + 1);
      // A cancelled, paused synthesizer would stay paused and silence the next reading.
      expect(speech.synth.paused).toBe(false);
      expect(within(bar).queryByRole('button', { name: /Stop/ })).toBeNull();
    } finally {
      speech.remove();
    }
  });

  it('the Stop button stops the reading', async () => {
    const { speech, bar } = await readingSample();
    try {
      fireEvent.click(within(bar).getByRole('button', { name: /Sentence/ }));
      fireEvent.click(await within(bar).findByRole('button', { name: /Stop/ }));
      expect(speech.synth.speaking).toBe(false);
    } finally {
      speech.remove();
    }
  });

  it('opening another document stops the reading', async () => {
    const { speech, controller, bar } = await readingSample();
    try {
      fireEvent.click(within(bar).getByRole('button', { name: /Sentence/ }));
      const stops = speech.synth.cancelled;
      await openAndWait(controller, () => controller.openText('Another text to check.'));
      expect(speech.synth.cancelled).toBeGreaterThan(stops);
      expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
    } finally {
      speech.remove();
    }
  });
});

describe('read aloud follows the caret', () => {
  it('Sentence and Paragraph follow the language at the caret, and the note names the missing voice', async () => {
    const speech = installSpeech([LOCAL_VOICE]);
    try {
      const { controller } = makeController();
      renderShell(controller);
      const text = 'We went home.\nयह एक परीक्षण है।';
      await openAndWait(controller, () => controller.openText(text));
      const bar = await within(reviewPanel()).findByRole('group', { name: 'Read aloud' });
      const editor = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
      const disabled = () => ['Sentence', 'Paragraph'].map((name) => within(bar).getByRole('button', { name: new RegExp(name) }).hasAttribute('disabled'));
      const note = 'Sentence and Paragraph need a voice for Hindi on this PC.';

      act(() => {
        editor.focus();
        editor.dispatch({ selection: { anchor: 3 } });
      });
      expect(disabled()).toEqual([false, false]);
      expect(bar.textContent).not.toContain('need a voice');

      act(() => editor.dispatch({ selection: { anchor: text.indexOf('परीक्षण') } }));
      expect(disabled()).toEqual([true, true]);
      expect(bar.textContent).toContain(note);

      act(() => editor.dispatch({ selection: { anchor: 3 } }));
      expect(disabled()).toEqual([false, false]);
      expect(bar.textContent).not.toContain('need a voice');
    } finally {
      speech.remove();
    }
  });
});
