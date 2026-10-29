// F23 item 5 (list item 22): a quick-fix popover on the underline. Clicking an underlined word, or Alt+Enter on it,
// shows the card's actions next to the word. It runs the card's own handlers, so the text and the change log come
// out byte for byte as from the card. Focus goes in and comes back; Escape closes it. Batch cards (the simple-fixes
// card included) stay in the panel.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import type { SessionController } from '@/ui/state/sessionController';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

const TEXT = 'Each farmer should recieve water, and the the road is long.';

const editor = () => EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)!;
const popover = () => screen.queryByRole('dialog', { name: /^Quick fix/ });

/** Puts the cursor inside `word` and presses Alt+Enter there. */
function altEnterIn(word: string): EditorView {
  const view = editor();
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(word) + 1 } });
  });
  fireEvent.keyDown(view.contentDOM, { key: 'Enter', altKey: true });
  return view;
}

async function opened(): Promise<SessionController> {
  return (await openedApp()).controller;
}

async function openedApp() {
  const { controller } = makeController({ preset: 'blog' });
  const { unmount } = renderShell(controller);
  await openAndWait(controller, () => controller.openText(TEXT));
  return { controller, unmount };
}

/** Leaves out the entries' time stamps: the two runs happen at different moments. */
const withoutTimes = (key: string, value: unknown) => (key === 'at' ? undefined : value);

/** What a save would write, and the change log's entries. */
function result(controller: SessionController) {
  const session = controller.getState().session!;
  return {
    text: session.paragraphs().map((p) => session.outputText(p.id)),
    log: JSON.stringify(session.log(), withoutTimes),
    outcomes: JSON.stringify(session.outcomes(), withoutTimes),
  };
}

describe('the quick-fix popover (F23 item 5)', () => {
  it('Alt+Enter on an underline opens it with the card’s actions, focus inside; Escape closes it and focus returns', async () => {
    await opened();
    const view = altEnterIn('recieve');
    const dialog = popover()!;
    expect(dialog).not.toBeNull();
    const names = within(dialog).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(expect.arrayContaining(['Use “receive”', 'Reject', 'Add to dictionary']));
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(popover()).toBeNull();
    expect(view.contentDOM.contains(document.activeElement)).toBe(true);
  });

  it('a click on an underlined word opens it too', async () => {
    await opened();
    const view = editor();
    vi.spyOn(view, 'posAtCoords').mockReturnValue(view.state.doc.toString().indexOf('recieve') + 2);
    fireEvent.click(view.contentDOM, { clientX: 5, clientY: 5 });
    expect(popover()).not.toBeNull();
  });

  it('accepting from the popover and from the card give the same text, log and outcomes', async () => {
    const { controller: fromCard, unmount } = await openedApp();
    altEnterIn('recieve');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    for (let i = 0; i < 5 && !/recieve/.test(reviewPanel().querySelector('.card-title')!.textContent!); i++) fireEvent.keyDown(reviewPanel(), { key: 'j' });
    fireEvent.click(within(reviewPanel().querySelector<HTMLElement>('.card')!).getByRole('button', { name: /Use “receive”/ }));
    const cardResult = result(fromCard);
    unmount();

    const fromPopover = await opened();
    const view = altEnterIn('recieve');
    fireEvent.click(within(popover()!).getByRole('button', { name: 'Use “receive”' }));
    expect(popover()).toBeNull();
    expect(view.contentDOM.contains(document.activeElement)).toBe(true);
    expect(result(fromPopover)).toEqual(cardResult);
    expect(cardResult.text[0]).toContain('receive');
  });

  it('does not open on a batch card’s place (the simple-fixes card): that stays in the panel', async () => {
    await opened();
    altEnterIn('the the');
    expect(popover()).toBeNull();
  });
});
