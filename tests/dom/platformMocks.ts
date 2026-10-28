/**
 * Stand-ins for the Tauri modules the app shell imports. In a test file:
 *   vi.mock('@tauri-apps/api/window', async () => (await import('./platformMocks')).tauriWindow);
 * and the same for platformFiles, platformLinter and platformSettings. No app imports here: vi.mock
 * factories run before the test file's own imports.
 */
export const tauriWindow = { getCurrentWindow: () => ({ onCloseRequested: async () => () => {}, destroy: async () => {}, setTitle: async () => {} }) };
export const platformFiles = { files: { open: async () => null, save: async () => null }, onFileDrop: async () => () => {}, setDialogLabels: () => {} };
export const platformLinter = { createAppLinter: () => Promise.reject(new Error('not used in tests')) };
export const platformSettings = { loadSettings: async () => null, saveSettings: async () => {} };
