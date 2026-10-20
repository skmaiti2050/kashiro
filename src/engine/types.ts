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
}

export type Tier = 'safe' | 'batch' | 'review' | 'hidden';
