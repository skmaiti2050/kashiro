// About › Third-party notices as readable text (Task U3 item 8): a tiny, safe Markdown subset.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { markdownBlocks } from '@/ui/state/noticeBlocks';

describe('markdownBlocks', () => {
  it('headings, paragraphs (wrapped lines joined) and lists with continuation lines', () => {
    const md = ['# Fonts attribution', '', 'The app bundles', 'four fonts.', '', '- First item', '  continues here.', '- Second', '', '1. One', '2. Two'].join('\n');
    expect(markdownBlocks(md)).toEqual([
      { kind: 'heading', level: 1, text: [{ kind: 'text', text: 'Fonts attribution' }] },
      { kind: 'paragraph', text: [{ kind: 'text', text: 'The app bundles four fonts.' }] },
      { kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'First item continues here.' }], [{ kind: 'text', text: 'Second' }]] },
      { kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'One' }], [{ kind: 'text', text: 'Two' }]] },
    ]);
  });

  it('a fenced block (a licence text) stays verbatim, spacing and bullets included', () => {
    const licence = '                                 Apache License\n   * Redistributions of source code\n\n   1. Definitions.';
    expect(markdownBlocks(`## harper.js\n\n\`\`\`text\n${licence}\n\`\`\`\n`)).toEqual([
      { kind: 'heading', level: 2, text: [{ kind: 'text', text: 'harper.js' }] },
      { kind: 'code', text: licence },
    ]);
  });

  it('an unclosed fence keeps the rest of the file as code, nothing lost', () => {
    expect(markdownBlocks('```\nline one\nline two')).toEqual([{ kind: 'code', text: 'line one\nline two' }]);
  });

  it('inline code and bold; a link becomes its text and address as plain text', () => {
    expect(markdownBlocks('Use **Dakshina** from `LICENSE.md`, see [the site](https://example.org/x).')).toEqual([
      {
        kind: 'paragraph',
        text: [
          { kind: 'text', text: 'Use ' },
          { kind: 'strong', text: 'Dakshina' },
          { kind: 'text', text: ' from ' },
          { kind: 'code', text: 'LICENSE.md' },
          { kind: 'text', text: ', see the site (https://example.org/x).' },
        ],
      },
    ]);
  });

  it('HTML is text, never markup', () => {
    expect(markdownBlocks('<script>alert(1)</script> <b>x</b>')).toEqual([{ kind: 'paragraph', text: [{ kind: 'text', text: '<script>alert(1)</script> <b>x</b>' }] }]);
  });

  it('every bundled notice file parses with no Markdown syntax left in its text, and every fence closes', () => {
    for (const file of ['dictionary', 'frequency', 'romanised', 'fonts', 'i18n', 'harper', 'llama']) {
      const source = fs.readFileSync(`resources/${file}/ATTRIBUTION.md`, 'utf8');
      const blocks = markdownBlocks(source);
      const prose = blocks.flatMap((b) => (b.kind === 'code' ? [] : b.kind === 'list' ? b.items.flat() : b.text)).map((i) => i.text);
      for (const text of prose) expect(text, file).not.toMatch(/^#|```|\*\*|\]\(/);
      const fences = (source.match(/^```/gm) ?? []).length;
      expect(blocks.filter((b) => b.kind === 'code')).toHaveLength(fences / 2);
    }
  });
});
