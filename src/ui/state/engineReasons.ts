import type { MessageKey } from '../i18n/catalogues';
import { msg, type Message } from '../i18n/message';

/**
 * Why an edit could not be written into the file (src/formats: docx/write.ts and text.ts), by the
 * formats' exact text. The formats and the report keep their English; the change log shows these.
 */
const UNPLACEABLE: Record<string, MessageKey> = {
  'inside an existing tracked change': 'unplaceable.trackedChange',
  'touches a field (e.g. a cross-reference or page number)': 'unplaceable.field',
  'touches a tab, line break or embedded object': 'unplaceable.special',
  'touches hidden text': 'unplaceable.hiddenText',
  'crosses other document content': 'unplaceable.crossesContent',
  'crosses a hyperlink boundary': 'unplaceable.crossesHyperlink',
  'crosses an existing tracked change': 'unplaceable.crossesTrackedChange',
  'crosses a field': 'unplaceable.crossesField',
  'paragraph not found': 'unplaceable.paragraphNotFound',
  'span not found in the paragraph (out of range)': 'unplaceable.spanOutOfRange',
  'the replacement contains a tab or line break, which cannot be saved as plain text': 'unplaceable.lineBreak',
  'the replacement contains a character that cannot be saved in a Word document': 'unplaceable.illegalCharacter',
  'the span splits a character': 'unplaceable.splitsCharacter',
  'the replacement contains half a character': 'unplaceable.halfCharacter',
  'nowhere to insert text in this paragraph': 'unplaceable.nowhereToInsert',
  'touches locked content': 'unplaceable.lockedContent',
  'the text has a tracked formatting change': 'unplaceable.formattingChange',
  'the run also holds a text box that is being edited': 'unplaceable.textBox',
  'overlaps another edit': 'unplaceable.overlaps',
  'paragraph or span not found': 'unplaceable.textNotFound',
  // From the engine (session.ts RESTORED_INVISIBLE_REASON), not the formats.
  'it would delete an invisible character you restored': 'unplaceable.restoredInvisible',
};

/** An unknown text (a newer format reason) is shown as it is, in English. */
const asIs = (text: string) => msg('error.plain', { cause: text });

export function unplaceableMessage(reason: string): Message {
  const key = UNPLACEABLE[reason];
  return key ? msg(key) : asIs(reason);
}

// The ledger's reasons (src/engine/session.ts, editLedger.ts, sessionTypes.ts), one pattern each.
/** '"teh" added to dictionary' */
const ADDED_TO_DICTIONARY = /^"(.*)" added to dictionary$/;
/** 'restored after 0:4:7:Spelling was removed' */
const RESTORED_AFTER = /^restored after (.+) was removed$/;
/** 'superseded by 0:4:7:Spelling' */
const SUPERSEDED_BY = /^superseded by (.+)$/;
/** 'unplaceable: overlaps another edit' */
const UNPLACEABLE_REASON = /^unplaceable: (.+)$/s;

/** A change-log reason from the engine, in the UI language. */
export function reasonMessage(reason: string): Message {
  if (reason === 'undone') return msg('reason.undone');
  if (reason === 'inside an existing tracked change') return msg('reason.trackedChange');
  let match = ADDED_TO_DICTIONARY.exec(reason);
  if (match) return msg('reason.addedToDictionary', { word: match[1] });
  match = RESTORED_AFTER.exec(reason);
  if (match) return msg('reason.restoredAfter', { id: match[1] });
  match = SUPERSEDED_BY.exec(reason);
  if (match) return msg('reason.supersededBy', { id: match[1] });
  match = UNPLACEABLE_REASON.exec(reason);
  if (match) return msg('reason.unplaceable', { reason: unplaceableMessage(match[1]) });
  return asIs(reason);
}
