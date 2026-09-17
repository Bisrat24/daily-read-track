// Cloud book files: up to MAX_CLOUD_BOOKS book files per signed-in user, kept
// in the private `books` bucket under a `<user id>/` folder (RLS scoped).
// Only the file bytes live here — titles/progress keep syncing via sync.ts.

import { supabase } from "@/integrations/supabase/client";

export const MAX_CLOUD_BOOKS = 3;

export type CloudBook = {
  path: string;
  title: string;
  ext: string;
  size: number;
  updatedAt: number;
};

function extOf(name: string) {
  const m = /\.(pdf|epub)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "pdf";
}

function slug(title: string) {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80)
      .toLowerCase() || "book"
  );
}

function titleFromPath(path: string) {
  const file = path.split("/").pop() ?? path;
  return decodeURIComponent(file.replace(/\.(pdf|epub)$/i, "")).replace(/-/g, " ");
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function listCloudBooks(): Promise<CloudBook[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase.storage.from("books").list(uid, {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((f) => /\.(pdf|epub)$/i.test(f.name))
    .map((f) => ({
      path: `${uid}/${f.name}`,
      title: titleFromPath(f.name),
      ext: extOf(f.name),
      size: (f.metadata as { size?: number } | null)?.size ?? 0,
      updatedAt: new Date(f.updated_at ?? f.created_at ?? Date.now()).getTime(),
    }));
}

/** Upload a book file. Replaces the same title; refuses past the 3-file limit. */
export async function uploadCloudBook(
  file: File,
  title: string,
): Promise<CloudBook> {
  const uid = await currentUserId();
  if (!uid) throw new Error("Sign in first to keep books in your account.");
  if (file.size > 40 * 1024 * 1024) {
    throw new Error("That file is larger than 40 MB — too big to store online.");
  }
  const ext = extOf(file.name);
  const path = `${uid}/${slug(title)}.${ext}`;
  const existing = await listCloudBooks();
  if (!existing.some((b) => b.path === path) && existing.length >= MAX_CLOUD_BOOKS) {
    throw new Error(
      `You can keep ${MAX_CLOUD_BOOKS} books online. Remove one first, then try again.`,
    );
  }
  const { error } = await supabase.storage.from("books").upload(path, file, {
    upsert: true,
    contentType: ext === "epub" ? "application/epub+zip" : "application/pdf",
  });
  if (error) throw new Error(error.message);
  return { path, title, ext, size: file.size, updatedAt: Date.now() };
}

export async function downloadCloudBook(book: CloudBook): Promise<File> {
  const { data, error } = await supabase.storage.from("books").download(book.path);
  if (error || !data) throw new Error(error?.message ?? "Download failed.");
  return new File([data], `${slug(book.title)}.${book.ext}`, {
    type: book.ext === "epub" ? "application/epub+zip" : "application/pdf",
  });
}

export async function deleteCloudBook(path: string): Promise<void> {
  const { error } = await supabase.storage.from("books").remove([path]);
  if (error) throw new Error(error.message);
}
