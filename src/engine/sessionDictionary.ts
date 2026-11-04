import type { Decision } from './decisions';
import { dictionaryAccepts, dictionaryForm, storedForm } from './dictionaryWords';
import { decisionMembers, rankDecisions } from './sessionDecisions';
import { undo } from './sessionEdits';
import type { SessionState } from './sessionState';
import { WORD_REWRITE_KINDS } from './wordFlags';

/** CheckSession.addToDictionary: see there. */
export async function addFlaggedWord(s: SessionState, decisionId: string): Promise<void> {
  const members = decisionMembers(s, decisionId);
  const first = members[0];
  if (!WORD_REWRITE_KINDS.has(first.kind) || members.some((c) => c.original.toLowerCase() !== first.original.toLowerCase())) {
    throw new Error(`${decisionId} is not a word flag (Spelling/Typo of one word)`);
  }
  // As the user wrote it, not as its first place happens to be (a sentence start's capital): F20 item 9b.
  await addWord(s, dictionaryForm(members.map((c) => c.original)));
}

/** `alsoTypos`: words of the card that split out whatever the caller passed in `keepAsTypos`. */
export async function acceptWordCard(
  s: SessionState,
  kind: 'names' | 'terms' | 'otherLanguage',
  keepAsTypos: string[],
  alsoTypos: (card: Decision) => string[] = () => [],
): Promise<void> {
  const { top, more } = rankDecisions(s);
  const card = [...top, ...more].find((d) => d.kind === kind);
  if (!card) throw new Error(`there is no ${kind} card to accept: none of its words are pending`);
  const typos = new Set([...keepAsTypos, ...alsoTypos(card)].map((w) => w.toLowerCase()));
  const spellings = new Map<string, string[]>(); // lowercased → every spelling on the card, in order
  for (const id of card.candidateIds) {
    const original = s.cands.get(id)!.original;
    spellings.set(original.toLowerCase(), [...(spellings.get(original.toLowerCase()) ?? []), original]);
  }
  for (const [lower, written] of spellings) {
    if (typos.has(lower)) s.typoWords.add(lower);
    else await addWord(s, dictionaryForm(written));
  }
}

/**
 * Adds `word` to the linter and rejects every Spelling/Typo flag the entry accepts (dictionaryAccepts) that is
 * pending, or withdrawn under an edit the user applied (else undoing that edit would bring it back as a card: final
 * F14 review M-10). A fix of the word the user applied is taken back, as its Undo would: the next check no longer
 * flags the word, so it would drop the fix without a word (M-12, F20 item 9a). So is a fix the user accepted and an
 * AI rewrite was then made over, with the same log entry (#11); the rewrite stays, since it holds the text it replaced.
 */
export async function addWord(s: SessionState, written: string): Promise<void> {
  const word = storedForm(written); // "Cutover" is stored as "cutover" (Task F29)
  for (const engine of s.engines) await engine.addWords([word]);
  s.added.push(word);
  const reason = `"${word}" added to dictionary`;
  for (const c of s.cands.values()) {
    if (!WORD_REWRITE_KINDS.has(c.kind) || !dictionaryAccepts(word, c.original)) continue;
    const status = s.ledger.status.get(c.id);
    if (status === 'applied' && !s.ledger.autoApplied.has(c.id)) undo(s, c.id);
    else if (status !== 'pending' && !s.ledger.isCovered(c.id) && s.ledger.appliedOver(c.id) === undefined) continue;
    s.userRejected.add(c.id);
    s.ledger.record(c.id, 'rejected', false, reason);
  }
}
