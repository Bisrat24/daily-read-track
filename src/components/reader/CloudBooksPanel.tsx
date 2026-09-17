import { useCallback, useEffect, useRef, useState } from "react";
import { CloudUpload, CloudDownload, Trash2, Loader2, Library as LibraryIcon } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { parseFile, type ParsedBook } from "@/lib/parsers";
import {
  deleteCloudBook,
  downloadCloudBook,
  listCloudBooks,
  uploadCloudBook,
  MAX_CLOUD_BOOKS,
  type CloudBook,
} from "@/lib/cloudBooks";

export function CloudBooksPanel({ onLoaded }: { onLoaded: (book: ParsedBook) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [books, setBooks] = useState<CloudBook[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    void supabase.auth.getSession().then(({ data: d }) => setSession(d.session));
    return () => data.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    try {
      setBooks(await listCloudBooks());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    if (!session) { setBooks([]); return; }
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener("pace:cloud-books-changed", onChange);
    return () => window.removeEventListener("pace:cloud-books-changed", onChange);
  }, [session, refresh]);

  if (!session) return null;

  async function addFile(file: File) {
    setBusy("upload");
    try {
      const book = await parseFile(file);
      if (!book.words.length) throw new Error("Couldn't read any text from this file.");
      await uploadCloudBook(file, book.title);
      onLoaded(book);
      await refresh();
      toast.success(`"${book.title}" saved to your account.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    }
    setBusy(null);
  }

  async function fetchBook(b: CloudBook) {
    setBusy(b.path);
    try {
      const file = await downloadCloudBook(b);
      const parsed = await parseFile(file);
      if (!parsed.words.length) throw new Error("Couldn't read that file.");
      onLoaded(parsed);
      toast.success(`"${parsed.title}" is ready on this device.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't fetch that book.");
    }
    setBusy(null);
  }

  async function remove(b: CloudBook) {
    if (!confirm(`Remove "${b.title}" from your account? The copy on this device stays.`)) return;
    setBusy(b.path);
    try {
      await deleteCloudBook(b.path);
      await refresh();
      toast.success("Removed from your account.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove that book.");
    }
    setBusy(null);
  }

  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4">
      <div className="flex items-center gap-2">
        <LibraryIcon className="h-4 w-4 text-ember" />
        <span className="flex-1 font-display text-base font-semibold text-ink">Books in your account</span>
        <span className="text-xs text-muted-foreground">
          {books.length}/{MAX_CLOUD_BOOKS}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Keep up to {MAX_CLOUD_BOOKS} books you're reading in your account, then open them on any
        device — right where you left off.
      </p>

      <ul className="mt-3 space-y-2">
        {books.map((b) => (
          <li
            key={b.path}
            className="flex items-center gap-2 rounded-xl border border-border bg-card/70 p-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium capitalize text-ink">{b.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {b.ext.toUpperCase()} · {(b.size / 1024 / 1024).toFixed(1)} MB ·{" "}
                {new Date(b.updatedAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              disabled={busy !== null}
              onClick={() => void fetchBook(b)}
            >
              {busy === b.path ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudDownload className="h-3.5 w-3.5" />
              )}
              Open here
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              disabled={busy !== null}
              onClick={() => void remove(b)}
              aria-label="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
        {!books.length && (
          <li className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
            Nothing saved yet.
          </li>
        )}
      </ul>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void addFile(f);
        }}
      />
      <Button
        className="mt-3 w-full gap-2 bg-ember text-ember-foreground hover:bg-ember/90"
        disabled={busy !== null || books.length >= MAX_CLOUD_BOOKS}
        onClick={() => inputRef.current?.click()}
      >
        {busy === "upload" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CloudUpload className="h-4 w-4" />
        )}
        {books.length >= MAX_CLOUD_BOOKS ? "Limit reached — remove one first" : "Save a book to my account"}
      </Button>
    </section>
  );
}
