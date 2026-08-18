// Multi-book library management.
// Metadata (id, title, wordCount, position, addedAt, lastReadAt) lives in
// localStorage so the dashboard renders instantly. The full parsed word
// array for each book lives in IndexedDB under `pace.book.words.<id>` —
// localStorage would blow past the 5MB quota on any real book.

import { idbDel, idbGet, idbSet } from "@/lib/idb";
import { syntheticChapters, type Chapter, type ParsedBook } from "@/lib/parsers";

export const LIBRARY_KEY = "pace.library.v1";
export const ACTIVE_BOOK_KEY = "pace.activeBook.v1";

export type LibraryBook = {
  id: string;
  title: string;
  wordCount: number;
  position: number;
  addedAt: number;
  lastReadAt: number;
  chapters?: Chapter[];
  /** True when the entry came from cloud sync and the file isn't on this device yet. */
  remote?: boolean;
};

function isBrowser() {
  return typeof window !== "undefined";
}

function wordsKey(id: string) {
  return `pace.book.words.${id}`;
}

function newId() {
  if (isBrowser() && "randomUUID" in crypto) return crypto.randomUUID();
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadLibrary(): LibraryBook[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LibraryBook[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLibrary(books: LibraryBook[]) {
  if (!isBrowser()) return;
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(books));
  window.dispatchEvent(new Event("pace:library-changed"));
}

export function getActiveBookId(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(ACTIVE_BOOK_KEY);
}

export function setActiveBookId(id: string | null) {
  if (!isBrowser()) return;
  if (id) localStorage.setItem(ACTIVE_BOOK_KEY, id);
  else localStorage.removeItem(ACTIVE_BOOK_KEY);
}

export async function addBookToLibrary(book: ParsedBook): Promise<LibraryBook> {
  const id = newId();
  const now = Date.now();
  const list = loadLibrary();
  // If cloud sync already brought in this title as a placeholder, adopt its
  // saved position so the file lands exactly where the other device left off.
  const placeholderIdx = list.findIndex((b) => b.remote && b.title === book.title);
  const placeholder = placeholderIdx >= 0 ? list[placeholderIdx] : null;
  const wordCount = book.words.length;
  const entry: LibraryBook = {
    id,
    title: book.title,
    wordCount,
    position: placeholder
      ? Math.max(0, Math.min(Math.round((placeholder.position / Math.max(1, placeholder.wordCount)) * wordCount), wordCount))
      : 0,
    addedAt: now,
    lastReadAt: placeholder?.lastReadAt ?? now,
    chapters: book.chapters?.length ? book.chapters : syntheticChapters(wordCount),
  };
  await idbSet(wordsKey(id), book.words);
  if (placeholderIdx >= 0) list.splice(placeholderIdx, 1);
  list.unshift(entry);
  saveLibrary(list);
  return entry;
}

/** Add/refresh a title that exists only in the cloud backup (no file locally). */
export function upsertRemoteBook(meta: {
  title: string;
  wordCount: number;
  position: number;
  lastReadAt: number;
}) {
  const list = loadLibrary();
  const existing = list.find((b) => b.title === meta.title);
  if (existing) {
    if (existing.remote && (meta.lastReadAt ?? 0) >= (existing.lastReadAt ?? 0)) {
      existing.position = meta.position;
      existing.wordCount = meta.wordCount;
      existing.lastReadAt = meta.lastReadAt;
      saveLibrary(list);
    }
    return;
  }
  list.push({
    id: newId(),
    title: meta.title,
    wordCount: meta.wordCount,
    position: meta.position,
    addedAt: Date.now(),
    lastReadAt: meta.lastReadAt || Date.now(),
    remote: true,
  });
  saveLibrary(list);
}


export async function loadBookWords(id: string): Promise<string[] | null> {
  return await idbGet<string[]>(wordsKey(id));
}

export async function getFullBook(id: string): Promise<{ meta: LibraryBook; book: ParsedBook } | null> {
  const meta = loadLibrary().find((b) => b.id === id);
  if (!meta) return null;
  const words = await loadBookWords(id);
  if (!words) return null;
  const chapters = meta.chapters?.length ? meta.chapters : syntheticChapters(words.length);
  return { meta, book: { title: meta.title, words, chapters } };
}

export function updateBookPosition(id: string, position: number) {
  const list = loadLibrary();
  const b = list.find((x) => x.id === id);
  if (!b) return;
  b.position = Math.max(0, Math.min(position, b.wordCount));
  b.lastReadAt = Date.now();
  saveLibrary(list);
}

export async function deleteBook(id: string) {
  const list = loadLibrary().filter((b) => b.id !== id);
  saveLibrary(list);
  await idbDel(wordsKey(id));
  if (getActiveBookId() === id) setActiveBookId(null);
}

export function renameBook(id: string, title: string) {
  const list = loadLibrary();
  const b = list.find((x) => x.id === id);
  if (!b) return;
  b.title = title.trim() || b.title;
  saveLibrary(list);
}
