import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Decision } from '@/engine/decisions';
import type { SessionController } from '@/ui/state/sessionController';
import { buildDocx } from '../fixtures/make_docx';
import { makeController, Panel, warmLinter } from './harness';

beforeAll(warmLinter);

const TEXT = 'We could of finished it sooner. Each farmer should recieve water, and every family will recieve a card.';

/** A decision that is not the current card, so bringing it up is visible. */
function laterDecision(controller: SessionController): Decision {
  const { top, more } = controller.getState().session!.decisions();
  const later = [...top, ...more].slice(1).find((d) => d.kind !== 'names');
  if (!later) throw new Error('expected a second decision');
  return later;
}

/** The card slot, named for screen readers "Card N of M. <category>, <kind>. Change …". */
const slot = () => screen.getByRole('group', { name: /^Card \d+ of \d+ left\. / });

describe('clicking an underline brings up its card', () => {
  it('in a read-only document, the card comes up and takes keyboard focus', async () => {
    const { controller } = makeController();
    await controller.openFile({ name: 'essay.docx', path: '/docs/essay.docx', bytes: await buildDocx(`<w:p><w:r><w:t>${TEXT}</w:t></w:r></w:p>`) });
    const target = laterDecision(controller);
    const { rerender } = render(<Panel controller={controller} />);
    expect(slot().textContent).not.toContain(target.label);

    rerender(<Panel controller={controller} request={{ candidateId: target.candidateIds[0], seq: 1 }} />);
    expect(slot().textContent).toContain(target.label);
    expect(document.activeElement).toBe(slot());
  });

  it('in editable text, the card comes up but focus stays where the user is typing', async () => {
    const { controller } = makeController();
    await controller.openText(TEXT);
    const target = laterDecision(controller);
    const editor = document.createElement('div');
    editor.tabIndex = 0;
    document.body.append(editor);
    const { rerender } = render(<Panel controller={controller} />);
    editor.focus();

    rerender(<Panel controller={controller} request={{ candidateId: target.candidateIds[0], seq: 1 }} />);
    expect(slot().textContent).toContain(target.label);
    expect(document.activeElement).toBe(editor);
    editor.remove();
  });
});
