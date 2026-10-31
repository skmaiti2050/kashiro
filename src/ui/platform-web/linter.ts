import type { RulesLinter } from '@/engine/linter';
import type { Variant } from '@/engine/types';

// A stub until the web adapters land (web plan, Task 2+): same exports as src/ui/platform/linter.ts.
export async function createAppLinter(_variant: Variant, _words: string[]): Promise<RulesLinter> {
  throw new Error('not available on the web yet');
}
