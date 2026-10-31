import type { Capabilities } from '../platform/capabilities';

/** The web build: no AI, window memory or update check; text drops work; Save uses the save picker where the browser has one. */
export const capabilities: Capabilities = {
  ai: false,
  windowMemory: false,
  updates: false,
  textDrop: true,
  saveInPlace: 'showSaveFilePicker' in window ? 'picker' : 'download',
  web: true,
};
