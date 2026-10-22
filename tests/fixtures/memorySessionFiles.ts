import type { SessionFiles } from '@/ui/state/sessionStore';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The Rust side accepts hex and uuid keys only (sessions.rs). */
const SESSION_KEY = /^[0-9a-f-]{1,64}$/i;

/**
 * The app-data session files in memory, behaving as src-tauri/src/sessions.rs does: `written` is each
 * file's modified time (from `now`), and prune deletes by it.
 */
export function memorySessionFiles(now: () => Date = () => new Date()) {
  const stored = new Map<string, { json: string; written: number }>();
  const checkKey = (key: string) => {
    if (!SESSION_KEY.test(key)) throw new Error(`"${key}" is not a saved review's key`);
  };
  const files: SessionFiles = {
    save: async (key, json) => {
      checkKey(key);
      stored.set(key, { json, written: now().getTime() });
    },
    load: async (key) => {
      checkKey(key);
      return stored.get(key)?.json ?? null;
    },
    list: async () => ({ sessions: [...stored].map(([key, { json }]) => ({ key, json })), problems: [] }),
    delete: async (key) => {
      checkKey(key);
      stored.delete(key);
    },
    prune: async (keepDays) => {
      const cutoff = now().getTime() - keepDays * DAY_MS;
      for (const [key, { written }] of stored) if (keepDays === 0 || written < cutoff) stored.delete(key);
    },
  };
  return { files, stored };
}
