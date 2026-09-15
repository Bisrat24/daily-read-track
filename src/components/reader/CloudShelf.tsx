import { useCallback, useEffect, useState } from "react";
import { CloudUpload, CloudDownload, Trash2, Loader2, BookMarked } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { loadBookWords, loadLibrary, type LibraryBook } from "@/lib/library";
import {
  MAX_CLOUD_BOOKS,
  importCloudBook,
  loadCloudShelf,
  removeCloudBook,
  syncCloudPositions,
  uploadBookToCloud,
  type CloudEntry,
} from "@/lib/cloudBooks";

export function CloudShelf({ onOpen }: { onOpen: (id: string) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [shelf, setShelf] = useState<CloudEntry[]>([]);
  const [local, setLocal] = useState<LibraryBook[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    void supabase.auth.getSession().then(({ data: d }) => setSession(d.session));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const refresh = () => setLocal(loadLibrary().filter((b) => !b.remote));
    refresh();
    window.addEventListener("pace:library-changed", refresh);
    return () => window.removeEventListener("pace:library-changed", refresh);
  }, []);

  const uid = session?.user.id ?? null;

  const refreshShelf = useCallback(async () => {
    if (!uid) return setShelf([]);
    setLoading(true);
    try {
      setShelf(await syncCloudPositions(uid));
    } catch {
      try {
        setShelf(await loadCloudShelf(uid));
      } catch {
        /* offline */
      }
    }
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    void refreshShelf();
  }, [refreshShelf]);

  if (!uid) return null;

  const inCloud = new Set(shelf.map((e) => e.title));
  const uploadable = local.filter((b) => !inCloud.has(b.title));
  const full = shelf.length >= MAX_CLOUD_BOOKS;

  async function upload(book: LibraryBook) {
    if (!uid) return;
    setBusy(book.id);
    try {
      const words = await loadBookWords(book.id);
      if (!words) throw new Error("This book's text isn't on this device.");
      setShelf(await uploadBookToCloud(uid, book, words));
      toast.success(`"${book.title}" is now in your cloud shelf.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    }
    setBusy(null);
  }

  async function pull(entry: CloudEntry) {
    if (!uid) return;
    setBusy(entry.file);
    try {
      const id = await importCloudBook(uid, entry.file);
      toast.success(`"${entry.title}" added to this device.`);
      onOpen(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed.");
    }
    setBusy(null);
  }

  async function drop(entry: CloudEntry) {
    if (!uid) return;
    if (!confirm(`Remove "${entry.title}" from your cloud shelf? The copy on this device stays.`)) return;
    setBusy(entry.file);
    try {
      setShelf(await removeCloudBook(uid, entry.file));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove it.");
    }
    setBusy(null);
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card/60 p-4">
      <div className="flex items-center gap-2">
        <BookMarked className="h-4 w-4 text-ember" />
        <h2 className="flex-1 font-display text-base font-semibold text-ink">Cloud shelf</h2>
        <span className="text-xs text-muted-foreground">
          {loading ? "checking…" : `${shelf.length} of ${MAX_CLOUD_BOOKS}`}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Keep up to {MAX_CLOUD_BOOKS} books you're currently reading on your account. Sign in on any
        device and the whole book — plus your place in it — comes straight down.
      </p>

      {shelf.length > 0 && (
        <ul className="space-y-2">
          {shelf.map((e) => {
            const pct = e.wordCount ? Math.round((e.position / e.wordCount) * 100) : 0;
            const here = local.some((b) => b.title === e.title);
            return (
              <li key={e.file} className="rounded-xl border border-border bg-card/70 p-3">
                <p className="truncate font-display text-sm font-semibold text-ink">{e.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {pct}% read · saved {new Date(e.savedAt).toLocaleDateString()}
                  {e.device ? ` from ${e.device}` : ""}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-ember" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant={here ? "outline" : "default"}
                    disabled={busy !== null}
                    onClick={() => void pull(e)}
                    className={`h-8 gap-1.5 ${here ? "" : "bg-ember text-ember-foreground hover:bg-ember/90"}`}
                  >
                    {busy === e.file ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CloudDownload className="h-3.5 w-3.5" />
                    )}
                    {here ? "Download again" : "Add to this device"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void drop(e)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${e.title} from cloud shelf`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {uploadable.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {full ? "Shelf full — remove one to add another" : "Add a book from this device"}
          </p>
          <div className="flex flex-wrap gap-1">
            {uploadable.map((b) => (
              <Button
                key={b.id}
                size="sm"
                variant="outline"
                disabled={full || busy !== null}
                onClick={() => void upload(b)}
                className="h-8 max-w-full gap-1.5"
              >
                {busy === b.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="h-3.5 w-3.5" />
                )}
                <span className="truncate">{b.title}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
