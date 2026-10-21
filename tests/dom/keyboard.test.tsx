import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { DismissMenu } from '@/ui/DismissMenu';
import { speak } from '@/ui/platform/speech';
import { makeController, warmLinter } from './harness';
import { installSpeech, LOCAL_VOICE, ONLINE_VOICE, openAndWait, renderShell } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

describe('menus and the toolbar', () => {
  it('Dismiss ▾: Up / Down move between the items and wrap', () => {
    render(<DismissMenu kind="Readability"thisOneLabel="This one" onThisOne={() => {}} onRule={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss ▾' }));
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
  });

  it('Left / Right move along the toolbar; Escape closes the save menu and returns to its button', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const open = screen.getByRole('button', { name: 'Open' });
    open.focus();
    fireEvent.keyDown(open, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Paste' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(open);

    const menu = document.querySelector<HTMLDetailsElement>('.save-menu')!;
    act(() => {
      menu.open = true;
    });
    fireEvent.keyDown(screen.getByRole('radio', { name: /New copy/ }), { key: 'Escape' });
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('▾'));
  });
});

describe('the document text', () => {
  /** The editor, with the cursor put on the first character of `word`. */
  function cursorOn(word: string): EditorView {
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(word) + 1 } });
    });
    return view;
  }

  it('is named, and the flag under the cursor is described and read out', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const text = screen.getByRole('textbox', { name: 'Document text' });
    const described = document.getElementById(text.getAttribute('aria-describedby')!)!;
    expect(described.getAttribute('aria-live')).toBe('polite');

    cursorOn('could of');
    expect(described.textContent).toMatch(/^(Clarity|Correctness): /);
    cursorOn('farmers');
    expect(described.textContent).toBe('');
  });

  it('a re-check that removes the flag under a still cursor clears its description', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const described = document.getElementById('flag-at-cursor')!;
    cursorOn('could of');
    expect(described.textContent).not.toBe('');

    const kind = controller.getState().session!.candidates().find((c) => c.original === 'could of')!.kind;
    await act(async () => {
      controller.ignoreRule(kind, 'document');
      await controller.settled();
    });
    expect(described.textContent).toBe('');
  });

  it('Ctrl+. on an underline brings up its card and moves focus to it', async () => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openSample());
    const view = cursorOn('ferrocement');
    fireEvent.keyDown(view.contentDOM, { key: '.', ctrlKey: true });
    const slot = screen.getByRole('group', { name: /^Card \d+ of \d+ left\. Terms\./ });
    expect(document.activeElement).toBe(slot);
  });
});

describe('speak', () => {
  it('refuses a voice that is not local, whatever the caller passes', () => {
    const speech = installSpeech([ONLINE_VOICE, LOCAL_VOICE]);
    try {
      speak('Hello.', ONLINE_VOICE as unknown as SpeechSynthesisVoice, { rate: 1, pitch: 1 });
      expect(speech.spoken).toEqual([]);
      speak('Hello.', LOCAL_VOICE as unknown as SpeechSynthesisVoice, { rate: 1.2, pitch: 0.9 });
      expect(speech.spoken).toEqual([{ text: 'Hello.', voice: LOCAL_VOICE, rate: 1.2, pitch: 0.9 }]);
    } finally {
      speech.remove();
    }
  });
});
