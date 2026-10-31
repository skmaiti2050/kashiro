/**
 * The web build's storage: one IndexedDB database `kashiro` with the stores `settings` (the settings under the key
 * 'settings') and `sessions` (each saved review as { json, savedAt } under its key). Where the browser keeps nothing
 * (no IndexedDB, or it won't open, as in some private windows), everything lives in memory until the tab closes and
 * storageIsPersistent() says so (web plan, Review focus 1).
 */

const DATABASE = 'kashiro';
const VERSION = 1;
const STORES = ['settings', 'sessions'] as const;
export type StoreName = (typeof STORES)[number];

/** The few operations settings.ts and sessions.ts need, over IndexedDB or the memory fallback. */
export interface KeyValueStore {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  /** Reads, changes and writes one value in a single transaction, so another tab can't write in between. */
  update<T>(store: StoreName, key: string, change: (old: T | undefined) => T): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  /** Every key and value, in key order. */
  entries<T>(store: StoreName): Promise<[string, T][]>;
}

let persistent = true;
let opened: Promise<KeyValueStore> | null = null;
let lostListeners: (() => void)[] = [];

/** False once the browser has refused storage: what this tab saves is lost when it closes. */
export function storageIsPersistent(): boolean {
  return persistent;
}

/**
 * Calls `listener` once when the browser stops keeping what this tab saves: at once if it already has (no
 * IndexedDB), else on the first failed write.
 */
export function onStorageLost(listener: () => void): void {
  if (persistent) lostListeners.push(listener);
  else listener();
}

function storageLost(): void {
  if (!persistent) return;
  persistent = false;
  const listeners = lostListeners;
  lostListeners = [];
  for (const listener of listeners) listener();
}

/** The database, opened on first use; the memory store when the browser has none or refuses it. */
export function storage(): Promise<KeyValueStore> {
  opened ??= openDatabase().then(
    (db) => withMemoryFallback(indexedDbStore(db)),
    () => {
      storageLost();
      return memoryStore();
    },
  );
  return opened;
}

/**
 * `database`, until a write fails (a full quota; Safari's private mode opens the database, then refuses writes).
 * From then on everything goes to memory, seeded with what the database held, and the write is done there.
 */
function withMemoryFallback(database: KeyValueStore): KeyValueStore {
  let fallback: Promise<KeyValueStore> | null = null;
  const current = () => fallback ?? Promise.resolve(database);
  const toMemory = () => {
    fallback ??= seededMemoryStore(database).then((memory) => {
      storageLost();
      return memory;
    });
    return fallback;
  };
  /** Runs `write` on the current store; if the database refuses it, on memory instead. */
  const write = async (run: (store: KeyValueStore) => Promise<void>) => {
    const store = await current();
    try {
      await run(store);
    } catch (e) {
      if (store !== database) throw e; // memory failing is a real error
      await run(await toMemory());
    }
  };
  return {
    get: async (store, key) => (await current()).get(store, key),
    entries: async (store) => (await current()).entries(store),
    put: (store, key, value) => write((s) => s.put(store, key, value)),
    update: (store, key, change) => write((s) => s.update(store, key, change)),
    delete: (store, key) => write((s) => s.delete(store, key)),
  };
}

/** A memory store holding what `database` holds; empty stores where it can't even be read. */
async function seededMemoryStore(database: KeyValueStore): Promise<KeyValueStore> {
  const memory = memoryStore();
  for (const name of STORES) {
    const entries = await database.entries(name).catch(() => []);
    for (const [key, value] of entries) await memory.put(name, key, value);
  }
  return memory;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) return reject(new Error('This browser has no IndexedDB'));
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Runs `use` in one transaction on `store`; resolves with its result once the transaction has committed. */
function inTransaction<T>(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode, use: (s: IDBObjectStore) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result: T;
    use(tx.objectStore(store)).then((value) => (result = value), reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error(`Couldn't write to the browser's storage (${store})`));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function indexedDbStore(db: IDBDatabase): KeyValueStore {
  return {
    get: (store, key) => inTransaction(db, store, 'readonly', (s) => request(s.get(key))),
    put: (store, key, value) => inTransaction(db, store, 'readwrite', async (s) => void (await request(s.put(value, key)))),
    update: (store, key, change) =>
      inTransaction(db, store, 'readwrite', async (s) => {
        // A promise continuation after a request's success runs while the transaction is still active, so the put
        // joins the same transaction (true in every current browser).
        const old = await request(s.get(key));
        await request(s.put(change(old), key));
      }),
    delete: (store, key) => inTransaction(db, store, 'readwrite', async (s) => void (await request(s.delete(key)))),
    entries: (store) =>
      inTransaction(db, store, 'readonly', async (s) => {
        const [keys, values] = await Promise.all([request(s.getAllKeys()), request(s.getAll())]);
        return keys.map((key, i) => [String(key), values[i]]);
      }),
  };
}

/** The same operations on Maps; values are copied in and out, as IndexedDB does. */
function memoryStore(): KeyValueStore {
  const stores = new Map<StoreName, Map<string, unknown>>(STORES.map((name) => [name, new Map()]));
  const data = (store: StoreName) => stores.get(store)!;
  return {
    async get<T>(store: StoreName, key: string) {
      return structuredClone(data(store).get(key)) as T | undefined;
    },
    async put(store, key, value) {
      data(store).set(key, structuredClone(value));
    },
    async update<T>(store: StoreName, key: string, change: (old: T | undefined) => T) {
      data(store).set(key, structuredClone(change(structuredClone(data(store).get(key)) as T | undefined)));
    },
    async delete(store, key) {
      data(store).delete(key);
    },
    async entries<T>(store: StoreName) {
      const keys = [...data(store).keys()].sort();
      return keys.map((key): [string, T] => [key, structuredClone(data(store).get(key)) as T]);
    },
  };
}
