/**
 * Kinds of suggestion as the user sees them. A rule's own name ("BoundaryError", "WordChoice") is never
 * shown or spoken: card labels, announcements, the Dismiss ▾ menu and Settings use these labels.
 * Harper 2.13's LintKind values plus the engine's own kinds (Invisible, Variant, Contraction, Rewrite).
 */
export const KIND_LABELS: Record<string, string> = {
  Agreement: 'Agreement',
  BoundaryError: 'Words joined or split',
  Capitalization: 'Capital letters',
  Contraction: 'Contractions',
  Eggcorn: 'Misheard phrases',
  Enhancement: 'Stronger wording',
  Formatting: 'Formatting',
  Grammar: 'Grammar',
  Invisible: 'Invisible characters',
  Malapropism: 'Wrong word',
  Miscellaneous: 'Other',
  Nonstandard: 'Non-standard words',
  Punctuation: 'Punctuation',
  Readability: 'Readability',
  Redundancy: 'Unneeded words',
  Regionalism: 'Regional words',
  Repetition: 'Repeated words',
  Rewrite: 'AI rewrite',
  Spelling: 'Spelling',
  Style: 'Style',
  Typo: 'Typos',
  Usage: 'Usage',
  Variant: 'Spelling variant',
  WordChoice: 'Word choice',
  WordOrder: 'Word order',
};

/** The label of a kind of suggestion; a kind a newer Harper adds is "Other". */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? KIND_LABELS.Miscellaneous;
}
