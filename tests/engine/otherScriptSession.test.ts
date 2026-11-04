/**
 * Paragraphs written mostly in another script are set aside (#2a): no suggestion, no zero-click hygiene edit, and
 * their text is written back exactly. Mostly-English paragraphs with a foreign word are still checked.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { CheckOptions } from '@/engine/sessionTypes';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts: CheckOptions = { preset: 'business', variant: 'Indian', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [] };
const start = (texts: string[]) => CheckSession.start(texts.map((text, id) => ({ id, text })), opts, { linter });
const paraIds = (s: CheckSession) => new Set(s.candidates().map((c) => c.paraId));

const HINDI = 'यह एक परीक्षण है।';
const BENGALI = 'আমরা কাল বাজারে গিয়েছিলাম।';
const ENGLISH = 'We met on teh Monday.';
const HINDI_WITH_JUNK = 'मैंने teh किताब‍ पढ़ी,  यह बहुत अच्छी थी';

describe('mostlyNotChecked', () => {
  it('is true when set-aside paragraphs hold more letters than the checked ones', async () => {
    expect((await start([HINDI, HINDI, HINDI, ENGLISH])).mostlyNotChecked()).toBe(true);
  });

  it('is false for an English document', async () => {
    expect((await start([ENGLISH, ENGLISH])).mostlyNotChecked()).toBe(false);
  });
});

describe('a session sets aside paragraphs in another script', () => {
  it('exposes their ids, in document order', async () => {
    const s = await start([ENGLISH, HINDI, BENGALI]);
    expect(s.otherScriptParagraphs()).toEqual([1, 2]);
  });

  it('has candidates only in the English paragraph', async () => {
    const s = await start([HINDI, BENGALI, ENGLISH]);
    expect([...paraIds(s)]).toEqual([2]);
  });

  it('a Hindi paragraph with teh, a ZWJ and a double space gets no candidate and is written back byte-identical', async () => {
    const s = await start([HINDI_WITH_JUNK, ENGLISH]);
    expect(s.candidates().filter((c) => c.paraId === 0)).toEqual([]);
    expect(s.paragraphs()[0]!.text).toBe(HINDI_WITH_JUNK);
  });

  it('a mostly English paragraph with a Hindi word is still checked', async () => {
    const s = await start(['She said "धन्यवाद" and left teh room quietly.']);
    expect(s.otherScriptParagraphs()).toEqual([]);
    expect(s.candidates().some((c) => c.original === 'teh')).toBe(true);
  });

  it('keeps paragraph ids and offsets right around a skipped paragraph', async () => {
    const texts = [ENGLISH, HINDI_WITH_JUNK, ENGLISH];
    const s = await start(texts);
    expect(s.paragraphs().map((p) => p.text)).toEqual(texts);
    expect(s.candidates().filter((c) => c.paraId === 1)).toEqual([]);
    const teh = s.candidates().find((c) => c.paraId === 2 && c.original === 'teh')!;
    expect(teh).toBeDefined();
    expect(s.paragraphs()[2]!.text.slice(teh.span.start, teh.span.end)).toBe('teh');
  });

  it('lists the passages it did not check inside English paragraphs, in document order (#29)', async () => {
    const english = "She said नमस्ते and left teh room. C'est la vie, mon ami.";
    const s = await start([HINDI, english]);
    const passages = s.uncheckedPassages();
    expect(passages.map((p) => [p.paraId, p.kind, english.slice(p.span.start, p.span.end)])).toEqual([
      [1, 'otherScript', 'नमस्ते'],
      [1, 'otherLanguage', "C'est la vie, mon ami."],
    ]);
    // Report only: English checking is unchanged.
    expect(s.candidates().some((c) => c.paraId === 1 && c.original === 'teh')).toBe(true);
  });

  it('a set-aside paragraph contributes no passages, and an English one has none', async () => {
    const s = await start([HINDI, 'We met on Monday.']);
    expect(s.uncheckedPassages()).toEqual([]);
  });

  it('hasCheckedText is false for emoji-only and digits-only documents, true with a Latin word', async () => {
    expect((await start(['🎉🎉', ' '])).hasCheckedText()).toBe(false);
    expect((await start(['2024 — 10:30!'])).hasCheckedText()).toBe(false);
    expect((await start(['🎉 ok'])).hasCheckedText()).toBe(true);
    expect((await start([HINDI])).hasCheckedText()).toBe(false);
  });

  it('does not mix up the paragraphs the linter threw on', async () => {
    const s = await start([HINDI, ENGLISH]);
    expect(s.uncheckedParagraphs()).toEqual([]);
  });
});
