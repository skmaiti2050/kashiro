import type { MessageKey } from '../i18n/catalogues';
import type { Translator } from '../i18n/translator';

/**
 * Kinds of suggestion as the user sees them. A rule's own name ("BoundaryError", "WordChoice") is never
 * shown or spoken: card labels, announcements, the Dismiss ▾ menu and Settings use these labels.
 * Harper 2.13's LintKind values plus the engine's own kinds (Invisible, Variant, Contraction, Rewrite).
 */
export const KIND_KEYS: Record<string, MessageKey> = {
  Agreement: 'kind.Agreement',
  BoundaryError: 'kind.BoundaryError',
  Capitalization: 'kind.Capitalization',
  Contraction: 'kind.Contraction',
  Eggcorn: 'kind.Eggcorn',
  Enhancement: 'kind.Enhancement',
  Formatting: 'kind.Formatting',
  Grammar: 'kind.Grammar',
  Invisible: 'kind.Invisible',
  Malapropism: 'kind.Malapropism',
  Miscellaneous: 'kind.Miscellaneous',
  Nonstandard: 'kind.Nonstandard',
  Punctuation: 'kind.Punctuation',
  Readability: 'kind.Readability',
  Redundancy: 'kind.Redundancy',
  Regionalism: 'kind.Regionalism',
  Repetition: 'kind.Repetition',
  Rewrite: 'kind.Rewrite',
  Spelling: 'kind.Spelling',
  Style: 'kind.Style',
  Typo: 'kind.Typo',
  Usage: 'kind.Usage',
  Variant: 'kind.Variant',
  WordChoice: 'kind.WordChoice',
  WordOrder: 'kind.WordOrder',
};

/** The key of a kind's label; a kind a newer Harper adds is "Other". */
export function kindKey(kind: string): MessageKey {
  return KIND_KEYS[kind] ?? 'kind.Miscellaneous';
}

export function kindLabel(t: Translator, kind: string): string {
  return t.t(kindKey(kind));
}
