import { appWorker } from '../linterWorker/appWorker';
import { createWorkerLinter } from '../linterWorker/workerLinter';
import type * as desktop from '../platform/linter';

/**
 * As on the desktop: Harper runs in a Worker, which loads harper.js/binary's .wasm as a separate asset that Vite
 * emits under the web build's base path (/kashiro/assets/…).
 */
export const createAppLinter: typeof desktop.createAppLinter = (variant, words) => createWorkerLinter(variant, words, appWorker);
