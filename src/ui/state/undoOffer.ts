import type { CheckSession } from '@/engine/session';
import type { MessageKey } from '../i18n/catalogues';
import { msg, type Message } from '../i18n/message';

/**
 * The undo toast after a big action (Task F21b item 8): "Applied 12 fixes · Undo", "Rejected 600 suggestions · Undo".
 * It is offered after an action on more than one place, and only until the next change to the review: after that,
 * its Undo might no longer match what the action did.
 */
export type UndoOffer =
  /** An "Apply" from a card's preview (Tick all included): the batch's id, for CheckSession.undoBatch. */
  | { kind: 'applied'; batchId: string; message: Message; seq: number }
  /** Places rejected together (Reject, Ignore all, Dismiss on a card): back to review one by one. */
  | { kind: 'rejected'; ids: string[]; message: Message; seq: number };

/** Fewest places an action covers for its undo toast: one place has its own Undo in the change log. */
const BIG_ACTION_PLACES = 2;

/** The toast's text for places rejected together, by the verb the action announced. */
const REJECTED_MESSAGES: Partial<Record<MessageKey, MessageKey>> = {
  'verb.rejected': 'toast.rejected',
  'verb.ignored': 'toast.ignored',
  'verb.dismissed': 'toast.dismissed',
};

/** The places applyBatch's batch `batchId` still has applied. */
export function appliedInBatch(session: CheckSession, batchId: string): string[] {
  return session
    .outcomes()
    .filter((o) => o.batch === batchId && o.status === 'applied')
    .map((o) => o.candidate.id);
}

export function appliedOffer(session: CheckSession, batchId: string, seq: number): UndoOffer | null {
  const count = appliedInBatch(session, batchId).length;
  if (count < BIG_ACTION_PLACES) return null;
  return { kind: 'applied', batchId, message: msg('toast.applied', { count }), seq };
}

export function rejectedOffer(ids: string[], verb: MessageKey, seq: number): UndoOffer | null {
  const key = REJECTED_MESSAGES[verb];
  if (ids.length < BIG_ACTION_PLACES || !key) return null;
  return { kind: 'rejected', ids, message: msg(key, { count: ids.length }), seq };
}
