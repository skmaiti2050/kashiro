import type { SessionFiles } from '../state/sessionStore';

// A stub until the web adapters land (web plan, Task 2+): same exports as src/ui/platform/sessions.ts.
const notYet = (): never => {
  throw new Error('not available on the web yet');
};

export const sessionFiles: SessionFiles = {
  save: async () => notYet(),
  load: async () => notYet(),
  list: async () => notYet(),
  delete: async () => notYet(),
  prune: async () => notYet(),
};
