// A tiny key-value store on IndexedDB (no library). It holds the offline outbox, which has to
// survive a reload. Where IndexedDB is unavailable (private mode, old browsers, jsdom) it
// falls back to memory: sending still works, it just will not survive a reload.
export interface KvStore<T> {
  getAll(): Promise<T[]>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export const createMemoryKv = <T>(): KvStore<T> => {
  const map = new Map<string, T>();
  return {
    getAll: () => Promise.resolve([...map.values()]),
    put: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      map.clear();
      return Promise.resolve();
    },
  };
};

const promisify = <R>(request: IDBRequest<R>): Promise<R> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });

export const openKv = <T>(dbName: string, storeName: string): KvStore<T> => {
  if (typeof indexedDB === 'undefined') return createMemoryKv<T>();

  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('Could not open IndexedDB'));
      };
    });
    return db;
  };
  const store = async (mode: IDBTransactionMode): Promise<IDBObjectStore> =>
    (await open()).transaction(storeName, mode).objectStore(storeName);

  return {
    getAll: async () => promisify((await store('readonly')).getAll() as IDBRequest<T[]>),
    put: async (key, value) => {
      await promisify((await store('readwrite')).put(value, key));
    },
    delete: async (key) => {
      await promisify((await store('readwrite')).delete(key));
    },
    clear: async () => {
      await promisify((await store('readwrite')).clear());
    },
  };
};
