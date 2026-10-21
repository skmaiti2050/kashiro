/** A sentence end the cause may already have ("This is not a Word document."). */
const ENDS_SENTENCE = /[.!?]$/;

/**
 * A plain-language error: what happened, why, and what to do ("Couldn't save essay.docx: access denied.
 * Choose another folder and save again.").
 */
export function explain(what: string, cause: unknown, next: string): string {
  const because = (cause instanceof Error ? cause.message : String(cause)).trim();
  return `${what}: ${because}${ENDS_SENTENCE.test(because) ? '' : '.'} ${next}`;
}
