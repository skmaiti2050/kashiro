import type { MessageKey } from './catalogues';

export type MessageValue = string | number | Message;

/**
 * Text to show later, in whatever language is active then: a catalogue key and its values (which may be
 * messages too). The controller keeps notices, errors and announcements as messages, so switching the
 * language re-renders them, and the state itself has no language.
 */
export interface Message {
  key: MessageKey;
  values?: Record<string, MessageValue>;
}

export const msg = (key: MessageKey, values?: Record<string, MessageValue>): Message => (values ? { key, values } : { key });
