import type { RulesLinter } from '@/engine/linter';
import type { Variant } from '@/engine/types';
import { appWorker } from '../linterWorker/appWorker';
import { createWorkerLinter } from '../linterWorker/workerLinter';

/**
 * The webview's linter: Harper runs in a Worker (harperWorker.ts), which loads harper.js/binary as a separate .wasm
 * asset (not the 25 MB inlined build) and is replaced if Harper panics.
 */
export function createAppLinter(variant: Variant, words: string[]): Promise<RulesLinter> {
  return createWorkerLinter(variant, words, appWorker);
}
