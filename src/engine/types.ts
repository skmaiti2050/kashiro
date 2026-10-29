export type Variant = 'American' | 'British' | 'Australian' | 'Canadian' | 'Indian';

/** UTF-16 offsets into Paragraph.text, end exclusive. */
export interface Span {
  start: number;
  end: number;
}

export interface Paragraph {
  id: number;
  text: string;
  /** Adapter-supplied ranges that must not be touched (e.g. existing tracked changes). */
  locked?: Span[];
  /** Adapter-supplied: an item of a list whose label ("a.", "1.") the format draws itself, so its first word is not a sentence start. */
  listItem?: boolean;
  /** Adapter-supplied: a table cell (Markdown) or a paragraph inside a Word table, where spaces may be layout. */
  tableCell?: boolean;
  /** Adapter-supplied: the file has a blank line before this paragraph, so a command block above it ends there. */
  afterBlankLine?: boolean;
}

export type Source = 'rules' | 'hygiene' | 'llm' | 'preset';

export interface Candidate {
  id: string;
  paraId: number;
  span: Span;
  original: string;
  /** Empty for "no fix, just a flag". */
  replacements: string[];
  /** Harper LintKind, or 'Invisible' | 'Variant' | 'Contraction' | 'Rewrite'. */
  kind: string;
  message: string;
  source: Source;
  /**
   * The linter's own suggestions, kept when the engine added or removed some (spec §5 better suggestions).
   * Such a flag is never auto-applied, and the terms card judges the word by these.
   */
  linterReplacements?: string[];
}

export type Tier = 'safe' | 'batch' | 'review' | 'hidden';
