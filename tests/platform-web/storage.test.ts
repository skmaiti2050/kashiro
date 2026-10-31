// Web Task 2: settings and saved reviews in the browser's IndexedDB (database "kashiro", stores "settings" and
// "sessions"), with an in-memory fallback where the browser keeps nothing (Review focus 1), and a dictionary that
// another tab's stale save can't lose (Review focus 2). Each fresh import of the modules is one browser tab.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defaultSettings, type Settings } from '@/ui/state/settings';

type Value = unknown;

/** A request that succeeds (or fails) on a later microtask, like IndexedDB's. */
class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

/**
 * A minimal IndexedDB: open (with upgradeneeded on first open), transactions on one store, and get / put / delete /
 * getAll / getAllKeys. A transaction completes once its requests have finished and nothing new was asked of it.
 */
function fakeIndexedDB() {
  const databases = new Map<string, Map<string, Map<string, Value>>>();
  /** When true, every write fails and aborts its transaction, like Safari's private mode or a full quota. */
  const writes = { fail: false };

  function transaction(stores: Map<string, Map<string, Value>>, name: string) {
    const data = stores.get(name);
    if (!data) throw new Error(`NotFoundError: no store ${name}`);
    let pending = 0;
    let done = false;
    const tx = {
      error: null as Error | null,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      objectStore: () => store,
    };
    const finishLater = () =>
      setTimeout(() => {
        if (pending > 0 || done) return;
        done = true;
        tx.oncomplete?.();
      }, 0);
    function ask<T>(run: () => T) {
      const request = new FakeRequest<T>();
      pending++;
      queueMicrotask(() => {
        request.result = run();
        request.onsuccess?.();
        pending--;
        finishLater();
      });
      return request;
    }
    function refuse() {
      const request = new FakeRequest<undefined>();
      queueMicrotask(() => {
        request.error = tx.error = new Error('QuotaExceededError');
        request.onerror?.();
        done = true;
        tx.onabort?.();
      });
      return request;
    }
    const write = (run: () => void) => (writes.fail ? refuse() : ask(run));
    const sortedKeys = () => [...data.keys()].sort();
    const store = {
      get: (key: string) => ask(() => structuredClone(data.get(key))),
      put: (value: Value, key: string) => write(() => void data.set(key, structuredClone(value))),
      delete: (key: string) => write(() => void data.delete(key)),
      getAllKeys: () => ask(() => sortedKeys()),
      getAll: () => ask(() => sortedKeys().map((key) => structuredClone(data.get(key)))),
    };
    return tx;
  }

  return {
    open(name: string) {
      const request = new FakeRequest<unknown>();
      queueMicrotask(() => {
        const isNew = !databases.has(name);
        const stores = databases.get(name) ?? new Map<string, Map<string, Value>>();
        databases.set(name, stores);
        request.result = {
          objectStoreNames: { contains: (store: string) => stores.has(store) },
          createObjectStore: (store: string) => stores.set(store, new Map()),
          transaction: (store: string) => transaction(stores, store),
        };
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
    /** What is stored under `key` in `store` of the "kashiro" database. */
    stored: (store: string, key: string) => databases.get('kashiro')?.get(store)?.get(key),
    writes,
  };
}

/** A new tab: fresh copies of the web storage modules, over whatever `indexedDB` is installed. */
async function openTab() {
  vi.resetModules();
  const settings = await import('@/ui/platform-web/settings');
  const sessions = await import('@/ui/platform-web/sessions');
  const storage = await import('@/ui/platform-web/storage');
  return { ...settings, ...sessions, ...storage };
}

const DAY_MS = 24 * 60 * 60 * 1000;

let idb: ReturnType<typeof fakeIndexedDB>;

beforeEach(() => {
  idb = fakeIndexedDB();
  vi.stubGlobal('indexedDB', idb);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('web settings', () => {
  it('round-trips the settings through IndexedDB, and a later tab reads them', async () => {
    const tab = await openTab();
    const settings: Settings = { ...(await tab.loadSettings()), preset: 'academic', dictionary: ['vantix', 'DBInstances'], overwrite: true };
    await tab.saveSettings(settings);
    expect((idb.stored('settings', 'settings') as Settings).dictionary).toEqual(['vantix', 'DBInstances']);
    const later = await openTab();
    expect(await later.loadSettings()).toEqual(settings);
    expect(later.storageIsPersistent()).toBe(true);
  });

  it('first start: the defaults', async () => {
    const tab = await openTab();
    expect(await tab.loadSettings()).toEqual(defaultSettings(navigator.language));
  });

  it('two tabs: a stale tab saving its settings keeps the word the other tab added', async () => {
    const a = await openTab();
    const settingsA = await a.loadSettings();
    const b = await openTab();
    const settingsB = await b.loadSettings();
    await a.saveSettings({ ...settingsA, dictionary: ['vantix'] });
    await b.saveSettings({ ...settingsB, preset: 'academic' });
    const stored = idb.stored('settings', 'settings') as Settings;
    expect(stored.dictionary).toEqual(['vantix']);
    expect(stored.preset).toBe('academic'); // the last write wins for everything else
  });

  it('a word removed in this tab stays removed (the merge keeps only words this tab never saw)', async () => {
    const tab = await openTab();
    await tab.saveSettings({ ...(await tab.loadSettings()), dictionary: ['vantix', 'nashik'] });
    const reloaded = await openTab();
    const settings = await reloaded.loadSettings();
    await reloaded.saveSettings({ ...settings, dictionary: ['nashik'] });
    expect((idb.stored('settings', 'settings') as Settings).dictionary).toEqual(['nashik']);
  });
});

describe('web saved reviews', () => {
  it('save, load, list and delete', async () => {
    const { sessionFiles } = await openTab();
    await sessionFiles.save('a1', '{"name":"one"}');
    await sessionFiles.save('b2', '{"name":"two"}');
    expect(await sessionFiles.load('a1')).toBe('{"name":"one"}');
    expect(await sessionFiles.load('zz')).toBeNull();
    expect(await sessionFiles.list()).toEqual({
      sessions: [
        { key: 'a1', json: '{"name":"one"}' },
        { key: 'b2', json: '{"name":"two"}' },
      ],
      problems: [],
    });
    await sessionFiles.delete('a1');
    expect(await sessionFiles.load('a1')).toBeNull();
    expect((await sessionFiles.list()).sessions.map((s) => s.key)).toEqual(['b2']);
  });

  it('prune(30) drops a review saved 31 days ago and keeps one saved today; prune(0) drops all', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = new Date('2026-10-31T12:00:00Z').getTime();
    const { sessionFiles } = await openTab();
    vi.setSystemTime(now - 31 * DAY_MS);
    await sessionFiles.save('old', '{}');
    vi.setSystemTime(now);
    await sessionFiles.save('new', '{}');
    await sessionFiles.prune(30);
    expect((await sessionFiles.list()).sessions.map((s) => s.key)).toEqual(['new']);
    await sessionFiles.prune(0);
    expect((await sessionFiles.list()).sessions).toEqual([]);
  });
});

describe('when writes start failing after the database opened (a full quota, Safari private mode)', () => {
  it('carries on in memory from what was stored, and reports the loss exactly once', async () => {
    const tab = await openTab();
    const lost = vi.fn();
    tab.onStorageLost(lost);
    const settings = await tab.loadSettings();
    await tab.saveSettings({ ...settings, dictionary: ['nashik'] });
    await tab.sessionFiles.save('a1', '{"name":"one"}');
    expect(lost).not.toHaveBeenCalled();

    idb.writes.fail = true;
    const withVantix = { ...settings, dictionary: ['nashik', 'vantix'] };
    await tab.saveSettings(withVantix); // no error: the save went to memory
    await tab.sessionFiles.save('b2', '{"name":"two"}');
    await tab.sessionFiles.delete('a1');
    await tab.saveSettings({ ...withVantix, preset: 'academic' });

    expect(await tab.loadSettings()).toEqual({ ...withVantix, preset: 'academic' });
    expect(await tab.sessionFiles.list()).toEqual({ sessions: [{ key: 'b2', json: '{"name":"two"}' }], problems: [] });
    expect(tab.storageIsPersistent()).toBe(false);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('seeds memory from both stores, so earlier reviews are still listed', async () => {
    const tab = await openTab();
    await tab.sessionFiles.save('a1', '{"name":"one"}');
    idb.writes.fail = true;
    await tab.saveSettings({ ...(await tab.loadSettings()), preset: 'academic' });
    expect(await tab.sessionFiles.load('a1')).toBe('{"name":"one"}');
    expect((await tab.loadSettings()).preset).toBe('academic');
  });
});

describe('without IndexedDB (a private window)', () => {
  it('reports the loss once, at once, to a listener that subscribes after the start', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const tab = await openTab();
    await tab.loadSettings();
    const lost = vi.fn();
    tab.onStorageLost(lost);
    await tab.saveSettings(await tab.loadSettings());
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('keeps settings and reviews in memory for this tab, and says storage is not persistent', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const tab = await openTab();
    const settings = { ...(await tab.loadSettings()), dictionary: ['vantix'] };
    await tab.saveSettings(settings);
    expect(await tab.loadSettings()).toEqual(settings);
    await tab.sessionFiles.save('a1', '{}');
    expect(await tab.sessionFiles.load('a1')).toBe('{}');
    expect(tab.storageIsPersistent()).toBe(false);
  });

  it('falls back to memory when opening the database fails', async () => {
    vi.stubGlobal('indexedDB', {
      open() {
        const request = new FakeRequest<unknown>();
        queueMicrotask(() => {
          request.error = new Error('InvalidStateError');
          request.onerror?.();
        });
        return request;
      },
    });
    const tab = await openTab();
    const settings = { ...(await tab.loadSettings()), preset: 'academic' as const };
    await tab.saveSettings(settings);
    expect(await tab.loadSettings()).toEqual(settings);
    expect(tab.storageIsPersistent()).toBe(false);
  });
});
