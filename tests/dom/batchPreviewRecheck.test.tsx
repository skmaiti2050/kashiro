import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { SIMPLE_FIXES_ID, type Decision } from '@/engine/decisions';
import type { SessionController } from '@/ui/state/sessionController';
import { makeController, warmLinter } from './harness';
import { openAndWait, renderShell, reviewPanel } from './shell';

vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
vi.mock('@/ui/platform/files', async () => (await import('./platformMocks')).platformFiles);
vi.mock('@/ui/platform/linter', async () => (await import('./platformMocks')).platformLinter);
vi.mock('@/ui/platform/settings', async () => (await import('./platformMocks')).platformSettings);

beforeAll(warmLinter);

/** The batch decision `pick` names, in the session as it is now. */
function batchDecision(controller: SessionController, pick: (id: string) => boolean): Decision {
  const { top, more } = controller.getState().session!.decisions();
  const decision = [...top, ...more].find((d) => d.kind === 'batch' && pick(d.id));
  if (!decision) throw new Error('No such batch card');
  return decision;
}

/** Presses J until the current card's title matches `title`. */
function showCard(title: RegExp): void {
  for (let i = 0; i < 20; i++) {
    if (title.test(reviewPanel().querySelector('.card-title')?.textContent ?? '')) return;
    fireEvent.keyDown(reviewPanel(), { key: 'j' });
  }
  throw new Error(`No card titled ${title}`);
}

/** Types `text` into the document and waits for its re-check to finish. */
async function retype(controller: SessionController, text: string) {
  act(() => controller.editText(text));
  await waitFor(() => expect(controller.getState().checking).toBe(false), { timeout: 10000 });
}

/** The members the open preview shows ticked (it lists the card's members in order). */
function tickedInPreview(decision: Decision): string[] {
  const boxes = [...reviewPanel().querySelectorAll<HTMLInputElement>('.batch-preview input[type=checkbox]')];
  return boxes.flatMap((box, i) => (box.checked ? [decision.candidateIds[i]] : []));
}

/** The members the engine starts ticked: on the simple-fixes card, an allowlisted doubling; elsewhere none. */
const engineTicks = (decision: Decision) => decision.candidateIds.filter((id) => !decision.startUnticked?.includes(id));

/** The members the engine leaves unticked that the open preview shows ticked. */
const tickedAgainstTheEngine = (decision: Decision) => tickedInPreview(decision).filter((id) => !engineTicks(decision).includes(id));

const isSimpleFixes = (id: string) => id === SIMPLE_FIXES_ID;

// Final F10 review I-1: the preview kept its tick state when a re-check gave the card's members new ids under the
// same card id, so places the user never ticked showed ticked and Enter applied them.
describe('an open batch preview after a re-check changes its members (Task F11)', () => {
  it.each([
    ['typed before both (the ids shift)', 'I recieve mail. You recieve calls.', 'Today I recieve mail. You recieve calls.', /recieve/, (id: string) => id.includes('recieve')],
    ['a third use typed', 'I recieve mail. You recieve calls.', 'I recieve mail. You recieve calls. They recieve gifts.', /recieve/, (id: string) => id.includes('recieve')],
    [
      'THAT THAT, typed before and a third',
      'He said THAT THAT was fine. I knew THAT THAT was wrong.',
      'Yes. He said THAT THAT was fine. I knew THAT THAT was wrong. THAT THAT is it.',
      /THAT THAT/,
      (id: string) => !isSimpleFixes(id),
    ],
    ['simple-fixes card, phonics "a a"', 'Say the sounds: a a, b b.', 'Now say the sounds: a a, b b.', /simple fix/i, isSimpleFixes],
    ['simple-fixes card, a slip and phonics "a a"', 'It was the the end. Say a a, b b.', 'So it was the the end. Say a a, b b.', /simple fix/i, isSimpleFixes],
  ])('%s: nothing the engine leaves unticked shows ticked, and Enter changes nothing', async (_name, before, after, title, pick) => {
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(before));
    showCard(title);
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    expect(reviewPanel().querySelector('.batch-preview')).toBeTruthy();

    await retype(controller, after);
    expect(tickedAgainstTheEngine(batchDecision(controller, pick))).toEqual([]);

    // The preview closed with the re-check, so Enter re-opens it with the engine's current ticks.
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    const now = batchDecision(controller, pick);
    expect(reviewPanel().querySelector('.batch-preview')).toBeTruthy();
    expect(tickedInPreview(now)).toEqual(engineTicks(now));
    const session = controller.getState().session!;
    expect(session.outputText(0)).toBe(after);
    expect(session.outcomes().filter((o) => o.status === 'applied')).toEqual([]);
  });

  it('a re-check that leaves the members as they were keeps the preview and the user’s ticks', async () => {
    const text = 'I recieve mail. You recieve calls.';
    const { controller } = makeController();
    renderShell(controller);
    await openAndWait(controller, () => controller.openText(text));
    showCard(/recieve/);
    fireEvent.keyDown(reviewPanel(), { key: 'Enter' });
    fireEvent.click(reviewPanel().querySelector<HTMLInputElement>('.batch-preview input[type=checkbox]')!);

    await retype(controller, `${text}\n\nThe road was long.`);
    const decision = batchDecision(controller, (id) => id.includes('recieve'));
    expect(tickedInPreview(decision)).toEqual([decision.candidateIds[0]]);
  });
});
