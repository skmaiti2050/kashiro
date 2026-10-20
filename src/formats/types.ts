import type { Paragraph } from '../engine/types';
import type { Edit } from '../engine/session';

export type SaveMode = 'tracked' | 'clean';

export interface FormatAdapter {
  exts: string[];
  language: 'plaintext' | 'markdown';
  read(bytes: Uint8Array): Promise<{ paras: Paragraph[]; handle: unknown }>;
  write(
    handle: unknown,
    edits: Edit[],
    mode: SaveMode,
  ): Promise<{ bytes: Uint8Array; unplaceable: { edit: Edit; reason: string }[] }>;
}
