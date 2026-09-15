// Up to 3 "currently reading" books kept in the app's own private cloud
// storage, so a second device can pull the actual book (not just its title)
// and continue at the synced position.
//
// Each entry is one JSON object in the private `books` bucket under the
// signed-in user's own folder: <uid>/<slug>.json. A small manifest.json in the
// same folder keeps human titles + progress so the shelf renders without
// downloading whole books.

import { supabase } from "@/integrations/supabase/client";
import { addBookToLibrary, loadLibrary, updateBookPosition, type LibraryBook } from "@/lib/library";
import { syntheticChapters, type Chapter } from "@/lib/parsers";

export const MAX_CLOUD_BOOKS = 3;
const BUCKET = "books";
const MANIFEST = "manifest.json";

export type CloudEntry = {
  file: string;
  title: string;
  wordCount: number;
  position: number;
  lastReadAt: number;
  savedAt: number;
  device?: string;
};

type Manifest = { version: 1; books: CloudEntry[] };

type CloudBookFile = {
  version: 1;
  title: string;
  wordCount: number;
  position: number;
  lastReadAt: number;
  chapters?: Chapter[];
  words: string[];
};

function slug(title: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "book"}.json`;
}

function deviceName() {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/mac os/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  return "Browser";
}

async function readJson<T>(uid: string, file: string): Promise<T | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(`${uid}/${file}`);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

async function writeJson(uid: string, file: string, value: unknown) {
  const body = new Blob([JSON.stringify(value)], { type: "application/json" });
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${uid}/${file}`, body, { upsert: true, contentType: "application/json" });
  if (error) throw new Error(error.message);
}

export async function loadCloudShelf(uid: string): Promise<CloudEntry[]> {
  const manifest = await readJson<Manifest>(uid, MANIFEST);
  return manifest?.books?.slice(0, MAX_CLOUD_BOOKS) ?? [];
}

async function saveShelf(uid: string, books: CloudEntry[]) {
  await writeJson(uid, MANIFEST, { version: 1, books } satisfies Manifest);
}

/** Upload (or refresh) one local book. Throws when the 3 slots are full. */
export async function uploadBookToCloud(uid: string, meta: LibraryBook, words: string[]) {
  const shelf = await loadCloudShelf(uid);
  const file = slug(meta.title);
  const existing = shelf.findIndex((e) => e.file === file);
  if (existing < 0 && shelf.length >= MAX_CLOUD_BOOKS) {
    throw new Error(`Cloud shelf is full (${MAX_CLOUD_BOOKS} books). Remove one first.`);
  }

  const payload: CloudBookFile = {
    version: 1,
    title: meta.title,
    wordCount: words.length,
    position: Math.max(0, Math.min(meta.position, words.length)),
    lastReadAt: meta.lastReadAt || Date.now(),
    chapters: meta.chapters?.length ? meta.chapters : syntheticChapters(words.length),
    words,
  };
  await writeJson(uid, file, payload);

  const entry: CloudEntry = {
    file,
    title: payload.title,
    wordCount: payload.wordCount,
    position: payload.position,
    lastReadAt: payload.lastReadAt,
    savedAt: Date.now(),
    device: deviceName(),
  };
  const next = existing >= 0 ? shelf.map((e, i) => (i === existing ? entry : e)) : [...shelf, entry];
  await saveShelf(uid, next);
  return next;
}

/** Keep the cloud copy's position in step with local reading (no re-upload of text). */
export async function syncCloudPositions(uid: string) {
  const shelf = await loadCloudShelf(uid);
  if (!shelf.length) return shelf;
  const local = loadLibrary();
  let changed = false;
  const next = shelf.map((e) => {
    const match = local.find((b) => b.title === e.title && !b.remote);
    if (!match || (match.lastReadAt ?? 0) <= (e.lastReadAt ?? 0)) return e;
    changed = true;
    return { ...e, position: match.position, lastReadAt: match.lastReadAt };
  });
  if (changed) await saveShelf(uid, next);
  return next;
}

export async function removeCloudBook(uid: string, file: string) {
  await supabase.storage.from(BUCKET).remove([`${uid}/${file}`]);
  const shelf = await loadCloudShelf(uid);
  const next = shelf.filter((e) => e.file !== file);
  await saveShelf(uid, next);
  return next;
}

/** Pull a cloud book onto this device and return its new local id. */
export async function importCloudBook(uid: string, file: string): Promise<string> {
  const data = await readJson<CloudBookFile>(uid, file);
  if (!data?.words?.length) throw new Error("That cloud book could not be read.");
  const entry = await addBookToLibrary({
    title: data.title,
    words: data.words,
    chapters: data.chapters,
  });
  const target = Math.max(0, Math.min(data.position ?? 0, data.words.length));
  if (target > 0) updateBookPosition(entry.id, target);
  return entry.id;
}
