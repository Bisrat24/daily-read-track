// IndexedDB key-value store for reliable on-device persistence.
// Falls back to no-op on the server. Used for large/structured data
// (parsed book contents, stats backups) where localStorage is unreliable
// on mobile due to size/eviction limits.

import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "pace-db";
const STORE = "kv";
const VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = getDB();
  if (!db) return null;
  try {
    const v = await (await db).get(STORE, key);
    return (v as T) ?? null;
  } catch {
    return null;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = getDB();
  if (!db) return;
  try {
    await (await db).put(STORE, value, key);
  } catch {
    /* ignore quota errors */
  }
}

export async function idbDel(key: string): Promise<void> {
  const db = getDB();
  if (!db) return;
  try {
    await (await db).delete(STORE, key);
  } catch {
    /* ignore */
  }
}
