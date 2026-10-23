import { UnreadableFileError, type FileProblem } from '@/formats/fileProblems';
import type { MessageKey } from '../i18n/catalogues';
import { msg, type Message } from '../i18n/message';

/** What to tell the user for each kind of file that can't be opened (Task U3 item 10). */
const FILE_PROBLEM_MESSAGES: Record<FileProblem, MessageKey> = {
  damaged: 'error.file.damaged',
  notWord: 'error.file.notWord',
  encrypted: 'error.file.encrypted',
  oldWord: 'error.file.oldWord',
  notUtf8: 'error.file.notUtf8',
  utf16: 'error.file.utf16',
  binary: 'error.file.binary',
  empty: 'error.file.empty',
  tooLong: 'error.file.tooLong',
};

/** Why `name` could not be opened: a specific message for a known file problem, else the system's reason. */
export function openError(name: string, cause: unknown): Message {
  if (cause instanceof UnreadableFileError) return msg(FILE_PROBLEM_MESSAGES[cause.problem], { name, ...cause.values });
  return explain(msg('error.open', { name }), cause, msg('error.openNext'));
}

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
