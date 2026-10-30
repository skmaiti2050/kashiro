/**
 * Tracked changes must mean exactly the clean save (Task F30): over the never-damage corpus, with every rule
 * suggestion accepted, "Accept All" in Word gives the clean-mode text byte for byte and "Reject All" gives the
 * original. The paragraphs are cut into short runs with alternating formatting, so many edits span runs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import JSZip from 'jszip';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { DEFAULT_MODULES } from '@/engine/modules';
import { PRESETS, type PresetId } from '@/engine/presets';
import { createDocxAdapter } from '@/formats/docx';
import { extractDocx } from '@/formats/docx/extract';
import { changedWords } from '@/formats/docx/changedWords';
import { acceptAllRules } from '../../../cli/run';
import { buildDocx } from '../../fixtures/make_docx';
import { acceptAllTexts, rejectAllTexts } from '../../fixtures/tracked_changes';
import { stressDocument, TICK_TRUTH } from '../../engine/neverDamageCorpus';

const SEED = 20261024;
const PARAGRAPHS = 80;
const RUN_LENGTH = 5;
const RUN_FORMATS = ['', '<w:rPr><w:b/></w:rPr>', '<w:rPr><w:i/></w:rPr>'];

const adapter = createDocxAdapter({ now: () => new Date('2026-10-30T12:00:00Z') });

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A paragraph cut every RUN_LENGTH code points into runs of rotating formatting; "\n" is a soft break. */
function paragraphXml(text: string): string {
  const runs: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (i > 0) runs.push('<w:r><w:br/></w:r>');
    const chars = Array.from(line);
    for (let at = 0; at < chars.length; at += RUN_LENGTH) {
      const chunk = escapeXml(chars.slice(at, at + RUN_LENGTH).join(''));
      runs.push(`<w:r>${RUN_FORMATS[runs.length % RUN_FORMATS.length]}<w:t xml:space="preserve">${chunk}</w:t></w:r>`);
    }
  });
  return `<w:p>${runs.join('')}</w:p>`;
}

async function documentOf(bytes: Uint8Array): Promise<string> {
  return (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
}

const CORPUS = [...stressDocument(SEED, PARAGRAPHS).map((p) => p.text), ...TICK_TRUTH.map((row) => row.input)];

describe('tracked changes: Accept All equals the clean save, Reject All equals the original (Task F30)', () => {
  it.each(Object.keys(PRESETS) as PresetId[])('%s preset, every rule suggestion accepted', async (preset) => {
    const bytes = await buildDocx(CORPUS.map(paragraphXml).join(''));
    const { paras, handle } = await adapter.read(bytes);
    const session = await CheckSession.start(
      paras,
      { preset, fallbackVariant: 'Indian', language: adapter.language, dictionary: [], modules: DEFAULT_MODULES },
      { linter },
    );
    acceptAllRules(session);
    const edits = session.acceptedEdits();
    expect(edits.length).toBeGreaterThan(50);
    // The test can't pass without narrowing: some edits keep shared words ("the the" → "the").
    const narrowed = edits.filter((e) => {
      const original = paras.find((p) => p.id === e.paraId)!.text.slice(e.span.start, e.span.end);
      const changed = changedWords(original, e.replacement);
      return changed.start > 0 || changed.end < original.length;
    });
    expect(narrowed.length).toBeGreaterThan(5);

    const tracked = await adapter.write(handle, edits, 'tracked');
    const clean = await adapter.write(handle, edits, 'clean');
    expect(tracked.unplaceable).toEqual(clean.unplaceable);
    const trackedXml = await documentOf(tracked.bytes);
    const cleanTexts = extractDocx(await documentOf(clean.bytes), 0).map((d) => d.para.text);

    expect(acceptAllTexts(trackedXml)).toEqual(cleanTexts);
    expect(rejectAllTexts(trackedXml)).toEqual(paras.map((p) => p.text));
  }, 60_000);
});
