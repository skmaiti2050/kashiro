import type * as desktop from '../platform/helper';

// The web has no writing helper (capabilities.ai is false, so the app hides AI and never starts one).
const NO_AI = 'AI is available in the desktop app';

const noHelper = (): never => {
  throw new Error(NO_AI);
};

export const modelFiles: typeof desktop.modelFiles = {
  choose: async () => noHelper(),
  hash: async () => noHelper(),
};

export const startAppHelper: typeof desktop.startAppHelper = async () => noHelper();

export const helperInstalled: typeof desktop.helperInstalled = async () => false;

/** Nothing runs, so there is nothing to stop. */
export const stopAppHelper: typeof desktop.stopAppHelper = async () => {};
