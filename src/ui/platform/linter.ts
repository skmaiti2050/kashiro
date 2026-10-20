import { binary } from 'harper.js/binary';
import { createLinter, type RulesLinter } from '@/engine/linter';
import type { Variant } from '@/engine/types';

/** The webview's linter: harper.js/binary loads Harper as a separate .wasm asset (not the 25 MB inlined build). */
export function createAppLinter(variant: Variant, words: string[]): Promise<RulesLinter> {
  return createLinter(variant, words, { binary });
}
