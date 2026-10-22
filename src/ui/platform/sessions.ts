import { invoke } from '@tauri-apps/api/core';
import type { SessionFiles } from '../state/sessionStore';

/**
 * The saved-review files, through the Rust commands in src-tauri/src/sessions.rs: they live in the app's
 * data folder, which the webview's fs scope (only files the user chose) does not reach.
 */
export const sessionFiles: SessionFiles = {
  save: (key, json) => invoke('session_save', { key, json }),
  load: (key) => invoke<string | null>('session_load', { key }),
  list: () => invoke<{ sessions: { key: string; json: string }[]; problems: string[] }>('session_list'),
  delete: (key) => invoke('session_delete', { key }),
  prune: (keepDays) => invoke('session_prune', { keepDays }),
};
