/**
 * Task F21 item E (owner, F20 adversarial review M-18). `(ami-0123456789abcdef0)` got a Spelling card on
 * `6789abcdef0` suggesting ")": accepting it deletes half an AMI ID. Hex fragments of AWS IDs, UUID groups and SHAs
 * got spelling cards ("f2a9c1e → face", "a5b → ab"), the ID prefixes too ("vpc → vac", "i-0abc… → I-0abc…"). No
 * spelling, word or capital card on an identifier now, and no fix turns a word into punctuation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CheckSession, type CheckOptions } from '@/engine/session';
import { createLinter, type RulesLinter } from '@/engine/linter';
import { isInIdentifier } from '@/engine/identifiers';
import { withoutNonWordFixes } from '@/engine/wordFlags';
import { WORD_REWRITE_KINDS } from '@/engine/wordFlags';
import type { Candidate } from '@/engine/types';
import { docxAdapter } from '@/formats/docx';
import { buildDocx } from '../fixtures/make_docx';

let linter: RulesLinter;
beforeAll(async () => {
  linter = await createLinter('Indian');
});

const opts = (over: Partial<CheckOptions> = {}): CheckOptions => ({ preset: 'business', fallbackVariant: 'Indian', language: 'plaintext', dictionary: [], ...over });

/** True when the first `part` of `text` (or the one at `at`) is part of an identifier. */
const inId = (text: string, part: string, at = text.indexOf(part)) => isInIdentifier(text, { start: at, end: at + part.length });

describe('isInIdentifier', () => {
  it.each([
    ['Launch from the image (ami-0123456789abcdef0) in the region.', '6789abcdef0'],
    ['Launch from the image (ami-0123456789abcdef0) in the region.', 'ami'],
    ['Use vpc-0a1b2c3d4e5f60718 and subnet-0f1e2d3c4b5a69788 for the cluster.', 'vpc'],
    ['Use vpc-0a1b2c3d4e5f60718 and subnet-0f1e2d3c4b5a69788 for the cluster.', 'b2c3d4e5f60718'],
    ['Use vpc-0a1b2c3d4e5f60718 and subnet-0f1e2d3c4b5a69788 for the cluster.', 'subnet'],
    ['Attach sg-0a1b2c3d4e5f67890 to i-0abcd1234efgh5678 now.', 'sg'],
    ['Attach sg-0a1b2c3d4e5f67890 to i-0abcd1234efgh5678 now.', 'i'],
    ['Snapshots snap-0a1b2c3d4e and vol-0123456789abcdef1, rtb-0a1b2c3d, igw-0f1e2d3c, eni-0a1b2c3d.', 'snap'],
    ['Snapshots snap-0a1b2c3d4e and vol-0123456789abcdef1, rtb-0a1b2c3d, igw-0f1e2d3c, eni-0a1b2c3d.', 'igw'],
    ['The fingerprint is a1b2c3d4e5f60718 on the host.', 'a1b2c3d4e5f60718'],
    ['The request id was 3f2a9c1e-7b4d-4e8a-9f0c-1d2e3f4a5b6c in the log.', 'f2a9c1e'],
    ['The request id was 3f2a9c1e-7b4d-4e8a-9f0c-1d2e3f4a5b6c in the log.', 'b4d'],
    ['The request id was 3f2a9c1e-7b4d-4e8a-9f0c-1d2e3f4a5b6c in the log.', 'f0c'],
    ['Revert commit 3911a5b and then 7b87fb0e9c1d.', 'a5b'],
    ['The role is arn:aws:iam::123456789012:role/deploy-role-prod today.', 'arn'],
    ['The role is arn:aws:iam::123456789012:role/deploy-role-prod today.', 'aws'],
    ['The role is arn:aws:iam::123456789012:role/deploy-role-prod today.', 'iam'],
    ['The build id is bld9x7k2q and the job is jb3kq9z.', 'bld9x7k2q'],
    ['The build id is bld9x7k2q and the job is jb3kq9z.', 'jb3kq9z'],
    ['It costs abc123def to fix.', 'abc123def'],
  ])('in "%s", %s is part of an identifier', (text, part) => {
    expect(inId(text, part)).toBe(true);
  });

  it.each([
    ['I think y0u are late.', 'y0u'],
    ['Read th9s now.', 'th9s'],
    ['We recieve1 items.', 'recieve1'],
    ['The decade was odd, and the facade too.', 'decade'],
    ['Key kp-deadbeefcafe is old.', 'deadbeefcafe'],
    ['Ask the aws team, i think.', 'i'],
    ['Use vpc peering in the subnet.', 'vpc'],
    ['A well-known fact.', 'well'],
    // Task F21c (F21 review M-26): a word of hex letters with one slipped digit is a typo, not a hash.
    ['She added1 more salt and faced2 the crowd.', 'added1'],
    ['She added1 more salt and faced2 the crowd.', 'faced2'],
    ['The decade2 was fine.', 'decade2'],
    ['The key deadbeef1 is old.', 'deadbeef1'],
  ])('in "%s", %s is a word, not an identifier', (text, part) => {
    expect(inId(text, part)).toBe(false);
  });

  it('a hex-like run needs two digits; a run mixing letters and digits twice stays hidden (accepted: "recie4ve2")', () => {
    expect(inId('Revert 6789abcdef0 now.', '6789abcdef0')).toBe(true);
    expect(inId('Revert a5b0ce now.', 'a5b0ce')).toBe(true);
    expect(inId('The wrd2s3 are wrong and recie4ve2 is a typo.', 'recie4ve2')).toBe(true);
  });

  it('with Harper, a hex-letter word with one slipped digit gets its spelling card back (review M-26)', async () => {
    const paras = [{ id: 0, text: 'She added1 more salt and faced2 the crowd.' }, { id: 1, text: 'The decade2 was fine.' }];
    const s = await CheckSession.start(paras, opts(), { linter });
    const { top, more } = s.decisions();
    const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
    const fixes = s.candidates().filter((c) => offered.has(c.id)).flatMap((c) => c.replacements.map((r) => `${c.original} → ${r}`));
    expect(fixes).toEqual(expect.arrayContaining(['added1 → added', 'faced2 → faced', 'decade2 → decade']));
  });
});

// Task F26 item 5 (owner): "…snapshot copy vantix-db-mumbai was stuck…" got "mumbai → Mumbai / mumble / mamba";
// accepting one renames an AWS resource. A lowercase hyphen-joined token of 3+ parts with an abbreviation-like part
// (no vowel, a digit, or a tech word) is an identifier, unless every part is a common English word.
describe('hyphen-joined resource names (F26 item 5)', () => {
  it.each([
    ['The snapshot copy vantix-db-mumbai was stuck.', 'mumbai'],
    ['The snapshot copy vantix-db-mumbai was stuck.', 'vantix'],
    ['The snapshot copy vantix-db-mumbai was stuck.', 'db'],
    ['Deploy my-app-prod-1 today.', 'prod'],
    ['Deploy my-app-prod-1 today.', 'app'],
    ['Restart the api-gatway-ecr service.', 'gatway'],
  ])('in "%s", %s is part of an identifier', (text, part) => {
    expect(inId(text, part)).toBe(true);
  });

  it.each([
    ['A state-of-the-art tool.', 'state'],
    ['Keep the list up-to-date.', 'date'],
    ['My mother-in-law came.', 'mother'],
    // A typo in a prose hyphenation keeps its card: "teh" and "knwon" are not common, but no part looks like an
    // abbreviation (each has a vowel, none has a digit, none is a tech word).
    ['A state-of-teh-art tool.', 'teh'],
    ['A well-knwon-fact.', 'knwon'],
    ['A well-knwon fact.', 'knwon'],
    // Two parts or a capital: not covered by this rule.
    ['Ask the db-admin now.', 'admin'],
    ['The Vantix-DB-Mumbai copy.', 'Mumbai'],
  ])('in "%s", %s is a word, not an identifier', (text, part) => {
    expect(inId(text, part)).toBe(false);
  });

  // Each flag reads at most 256 characters each way, so a flag-heavy chain stays linear (uncapped, 3,000 flags in
  // this chain took 4.6 s).
  it('a hyphen chain longer than any resource name is not one', () => {
    const chain = Array.from({ length: 20000 }, () => 'xq').join('-');
    const text = `See ${chain} here.`;
    expect(inId(text, 'xq', 4 + 3 * 10000)).toBe(false);
    expect(inId(text, 'xq', 4)).toBe(false);
    expect(inId('Use xq-xq-xq-1 here.', 'xq')).toBe(true);
  });

  it('with Harper: no card on any part of "vantix-db-mumbai"; "well-knwon" and "state-of-teh-art" keep theirs', async () => {
    const paras = [
      { id: 0, text: 'The snapshot copy vantix-db-mumbai was stuck for an hour.' },
      { id: 1, text: 'It is a well-knwon fact.' },
      { id: 2, text: 'We bought a state-of-teh-art printer.' },
    ];
    const s = await CheckSession.start(paras, opts(), { linter });
    const { top, more } = s.decisions();
    const offered = new Set([...top, ...more].flatMap((d) => d.candidateIds));
    for (const o of s.outcomes()) if (o.status === 'applied') offered.add(o.candidate.id);
    const flagged = s.candidates().filter((c) => offered.has(c.id) && WORD_REWRITE_KINDS.has(c.kind));
    expect(flagged.filter((c) => c.paraId === 0).map((c) => c.original)).toEqual([]);
    expect(flagged.map((c) => c.original)).toEqual(expect.arrayContaining(['knwon', 'teh']));
  });
});

describe('no fix turns a word into punctuation (the owner\'s "6789abcdef0" → ")")', () => {
  const cand = (original: string, replacements: string[], kind = 'Spelling'): Candidate => ({ id: 'x', paraId: 0, span: { start: 0, end: original.length }, original, replacements, kind, message: '', source: 'rules' });

  it('drops a replacement with no letter or digit for a word', () => {
    expect(withoutNonWordFixes(cand('6789abcdef0', [')'])).replacements).toEqual([]);
    expect(withoutNonWordFixes(cand('teh', ['the', '.', ''])).replacements).toEqual(['the']);
    expect(withoutNonWordFixes(cand('the', [')'], 'Grammar')).replacements).toEqual([]);
  });

  it('keeps the linter\'s list, a deletion by a rule other than spelling, and punctuation fixes of punctuation', () => {
    const c = withoutNonWordFixes(cand('6789abcdef0', [')', 'ce']));
    expect(c).toMatchObject({ replacements: ['ce'], linterReplacements: [')', 'ce'] });
    expect(withoutNonWordFixes(cand('very', [''], 'Redundancy')).replacements).toEqual(['']);
    expect(withoutNonWordFixes(cand(' ,', [','], 'Punctuation')).replacements).toEqual([',']);
    const same = cand('teh', ['the']);
    expect(withoutNonWordFixes(same)).toBe(same);
  });
});

describe('with Harper: no spelling, word or capital card on an identifier', () => {
  const TEXT = [
    'Launch from the image (ami-0123456789abcdef0) in the region.',
    'Use vpc-0a1b2c3d4e5f60718 and subnet-0f1e2d3c4b5a69788 for the cluster.',
    'The fingerprint is a1b2c3d4e5f60718 on the host.',
    'The role is arn:aws:iam::123456789012:role/deploy-role-prod and the bucket arn:aws:s3:::my-bucket-logs.',
    'The request id was 3f2a9c1e-7b4d-4e8a-9f0c-1d2e3f4a5b6c in the log.',
    'Revert commit 3911a5b and then 7b87fb0e9c1d2f3a4b5c6d7e8f9a0b1c2d3e4f5a.',
    'Attach sg-0a1b2c3d4e5f67890 to i-0abcd1234efgh5678 now.',
    'Image (ami-0abc123def4567890), volume (vol-0123456789abcdef1).',
    'The build id is bld9x7k2q and the job is jb3kq9z.',
    'aws ec2 run-instances --image-id ami-0123456789abcdef0 --subnet-id subnet-0f1e2d3c4b5a69788',
  ];
  const IDS = /ami-\S+|vpc-\S+|subnet-\S+|a1b2c3d4e5f60718|arn:\S+|3f2a9c1e-\S+|3911a5b|7b87fb0e\S+|sg-\S+|i-\S+|vol-\S+|bld9x7k2q|jb3kq9z/g;

  /** Every offered or applied flag on an identifier, by kind. */
  function onIdentifiers(s: CheckSession, paras: { id: number; text: string }[]): string[] {
    const { top, more } = s.decisions();
    const seen = new Set([...top, ...more].flatMap((d) => d.candidateIds));
    for (const o of s.outcomes()) if (o.status === 'applied') seen.add(o.candidate.id);
    return s
      .candidates()
      .filter((c) => seen.has(c.id) && (WORD_REWRITE_KINDS.has(c.kind) || c.kind === 'Capitalization'))
      .filter((c) => {
        const text = paras.find((p) => p.id === c.paraId)!.text;
        return [...text.matchAll(IDS)].some((m) => c.span.start < m.index! + m[0].length && m.index! < c.span.end);
      })
      .map((c) => `${c.kind} ${c.original} → ${c.replacements.join(' / ')}`);
  }

  it.each(['Indian', 'American', 'British'] as const)('plain text, %s', async (variant) => {
    const paras = TEXT.map((text, id) => ({ id, text }));
    const s = await CheckSession.start(paras, opts({ fallbackVariant: variant }), { linter: await createLinter(variant) });
    expect(onIdentifiers(s, paras)).toEqual([]);
  });

  it('a .docx, each line its own paragraph, the variant detected', async () => {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Word often splits a run at a bracket: "(", the ID, ")".
    const body = TEXT.map((line) => `<w:p>${line.split(/(?=[()])|(?<=[()])/).map((t) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join('')}</w:p>`).join('');
    const { paras } = await docxAdapter.read(await buildDocx(body));
    const s = await CheckSession.start(paras, opts(), { linter });
    expect(onIdentifiers(s, paras)).toEqual([]);
  });
});
