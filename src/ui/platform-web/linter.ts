import { binary } from 'harper.js/binary';
import { createLinter } from '@/engine/linter';
import type * as desktop from '../platform/linter';

/**
 * As on the desktop: harper.js/binary loads Harper's .wasm as a separate asset, which Vite emits under the web
 * build's base path (/kashiro/assets/…).
 */
export const createAppLinter: typeof desktop.createAppLinter = (variant, words) => createLinter(variant, words, { binary });
