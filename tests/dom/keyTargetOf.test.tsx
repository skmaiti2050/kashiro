import { describe, it, expect, beforeEach } from 'vitest';
import { keyTargetOf } from '@/ui/useKeys';

/** The app's three places: a document pane, the review panel and the toolbar ("other"). */
function layout() {
  document.body.innerHTML = `
    <nav class="toolbar"><button id="open">Open</button><select id="goal"><option>Blog</option></select></nav>
    <section class="document">
      <div class="cm-panels"><div class="cm-panel cm-search"><button id="find-next">next</button><label><input id="find-case" type="checkbox" />match case</label></div></div>
      <div class="cm-content" id="editable" contenteditable="true">Some text.</div>
      <div class="cm-content" id="readonly" contenteditable="false">Some text.</div>
    </section>
    <aside class="review" tabindex="-1">
      <div class="card-slot" id="slot" tabindex="-1">
        <button id="accept">Accept</button>
        <input id="tick" type="checkbox" />
        <input id="search" type="search" />
        <textarea id="note"></textarea>
        <details><summary id="more">More</summary></details>
        <a id="link" href="#x">link</a>
        <p id="text">plain</p>
      </div>
    </aside>`;
}

const byId = (id: string) => document.getElementById(id);

describe('keyTargetOf', () => {
  beforeEach(() => {
    layout();
    window.getSelection()?.removeAllRanges();
  });

  it('nothing focused (the page itself) counts as the document', () => {
    expect(keyTargetOf(document.body, false)).toEqual({ place: 'document', control: 'none', documentEditable: false, textSelected: false });
    expect(keyTargetOf(null, true).place).toBe('document');
  });

  it('places: the document pane, the review panel, anywhere else', () => {
    expect(keyTargetOf(byId('readonly'), false).place).toBe('document');
    expect(keyTargetOf(byId('slot'), false).place).toBe('panel');
    expect(keyTargetOf(byId('text'), false).place).toBe('panel');
    expect(keyTargetOf(byId('open'), false).place).toBe('other');
  });

  it('the Find panel inside the document pane counts as anywhere else, so its keys never decide cards (F23b)', () => {
    expect(keyTargetOf(byId('find-next'), false).place).toBe('other');
    expect(keyTargetOf(byId('find-case'), false).place).toBe('other');
  });

  it('the editable document and text fields are text entry; a read-only document is not', () => {
    expect(keyTargetOf(byId('editable'), true).control).toBe('text-entry');
    expect(keyTargetOf(byId('readonly'), false).control).toBe('none');
    expect(keyTargetOf(byId('search'), false).control).toBe('text-entry');
    expect(keyTargetOf(byId('note'), false).control).toBe('text-entry');
    // A select takes letters to pick an option.
    expect(keyTargetOf(byId('goal'), false).control).toBe('text-entry');
  });

  it('buttons, checkboxes, summaries and links are controls; plain text is none', () => {
    for (const id of ['accept', 'tick', 'more', 'link']) expect(keyTargetOf(byId(id), false).control).toBe('control');
    expect(keyTargetOf(byId('text'), false).control).toBe('none');
    expect(keyTargetOf(byId('slot'), false).control).toBe('none');
  });

  it('passes the document mode through and reads the text selection', () => {
    expect(keyTargetOf(byId('readonly'), true).documentEditable).toBe(true);
    const range = document.createRange();
    range.selectNodeContents(byId('readonly')!);
    window.getSelection()!.addRange(range);
    expect(keyTargetOf(byId('readonly'), false).textSelected).toBe(true);
    window.getSelection()!.collapseToStart();
    expect(keyTargetOf(byId('readonly'), false).textSelected).toBe(false);
  });
});
