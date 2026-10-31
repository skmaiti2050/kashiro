import type { ModelFiles } from '../state/sessionController';
import type { WritingHelper } from '../state/optionalModules';

// A stub until the web adapters land (web plan, Task 2+): same exports as src/ui/platform/helper.ts.
const notYet = (): never => {
  throw new Error('not available on the web yet');
};

export const modelFiles: ModelFiles = {
  choose: async () => notYet(),
  hash: async () => notYet(),
};

export async function startAppHelper(_modelPath: string): Promise<WritingHelper> {
  return notYet();
}

export const helperInstalled = async (): Promise<boolean> => notYet();

export const stopAppHelper = async (): Promise<void> => notYet();
