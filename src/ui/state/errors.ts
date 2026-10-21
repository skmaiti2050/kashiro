import { msg, type Message } from '../i18n/message';

/** A sentence end the cause may already have ("This is not a Word document."). */
const ENDS_SENTENCE = /[.!?]$/;

/** The text of a thrown error (from the system or a library: English, shown as it is). */
const causeOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).trim();

/**
 * A plain-language error: what happened, why, and what to do ("Couldn't save essay.docx: access denied.
 * Choose another folder and save again."). `what` and `next` are translated; the cause is the system's.
 */
export function explain(what: Message, cause: unknown, next: Message): Message {
  const because = causeOf(cause);
  return msg('error.explain', { what, cause: ENDS_SENTENCE.test(because) ? because : `${because}.`, next });
}

/** An error with nothing to add (an engine refusal): its own text. */
export const plainError = (cause: unknown): Message => msg('error.plain', { cause: causeOf(cause) });
