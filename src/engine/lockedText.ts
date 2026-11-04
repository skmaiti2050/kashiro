import { definedLinkLabels, findLockedSpans } from './factLock';
import { findCommandText, type CommandText } from './commands';
import type { CheckOptions } from './sessionTypes';
import type { Paragraph, Span } from './types';

/**
 * The text no fix may change without a click, by paragraph id: fact-locked spans (findLockedSpans), surely-command
 * text and the adapter's own locks (Paragraph.locked). Every engine's paragraphs get these (#1 gate 1).
 */
export function findLockedText(
  paras: readonly Paragraph[],
  language: CheckOptions['language'],
): { locked: Map<number, Span[]>; commands: CommandText } {
  // Commands are fact-locked too (never auto-applied, spelling asked on its own card); tierOf also hides every
  // other rule's flag on them (Task F20 item 1).
  const commands = findCommandText(paras);
  const { surely: commandSpans } = commands;
  const locked = new Map<number, Span[]>();
  // Link labels are Markdown only: in .txt and .docx "[the the]" is ordinary text.
  const linkLabels = language === 'markdown' ? definedLinkLabels(paras.map((p) => p.text)) : undefined;
  for (const p of paras) locked.set(p.id, [...findLockedSpans(p.text, linkLabels), ...commandSpans.get(p.id)!, ...(p.locked ?? [])]);
  return { locked, commands };
}
