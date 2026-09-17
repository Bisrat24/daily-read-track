import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, Sun, Moon, Plus } from "lucide-react";
import { Uploader } from "@/components/reader/Uploader";
import { SpeedReader } from "@/components/reader/SpeedReader";
import { StatsBar } from "@/components/reader/StatsBar";
import { ProgressCalendar } from "@/components/reader/ProgressCalendar";
import { Library } from "@/components/reader/Library";
import { SyncPanel } from "@/components/reader/SyncPanel";
import { CloudBooksPanel } from "@/components/reader/CloudBooksPanel";
import { uploadCloudBook } from "@/lib/cloudBooks";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { applyTheme, loadTheme, type Theme } from "@/lib/stats";
import {
  addBookToLibrary,
  getActiveBookId,
  getFullBook,
  setActiveBookId,
  updateBookPosition,
} from "@/lib/library";
import type { ParsedBook } from "@/lib/parsers";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pace — Train your reading speed" },
      { name: "description", content: "Build a personal library of PDFs and EPUBs, then speed-read each one with its own tracked progress." },
      { property: "og:title", content: "Pace — Train your reading speed" },
      { property: "og:description", content: "Build a personal library of PDFs and EPUBs, then speed-read each one with its own tracked progress." },
    ],
  }),
  component: Index,
  ssr: false,
});

type ActiveSession = {
  id: string;
  book: ParsedBook;
  position: number;
};

function Index() {
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  // Bootstrap: restore theme + reopen last active book (metadata only, don't
  // auto-start the reader).
  useEffect(() => {
    setTheme(loadTheme());
    const id = getActiveBookId();
    if (id) {
      void getFullBook(id).then((res) => {
        if (res) {
          setActive({ id: res.meta.id, book: res.book, position: res.meta.position });
          setActiveIdState(res.meta.id);
        }
        setReady(true);
      });
    } else {
      setReady(true);
    }
  }, []);

  async function openBook(id: string, autoStart = true) {
    // Persist the outgoing book's latest position before swapping.
    if (active && active.id !== id) {
      updateBookPosition(active.id, active.position);
    }
    const res = await getFullBook(id);
    if (!res) return;
    setActive({ id: res.meta.id, book: res.book, position: res.meta.position });
    setActiveIdState(res.meta.id);
    setActiveBookId(res.meta.id);
    if (autoStart) setReading(true);
  }

  async function onUploaded(book: ParsedBook, file?: File) {
    // Save outgoing progress, then add + open the new book.
    if (active) updateBookPosition(active.id, active.position);
    const entry = await addBookToLibrary(book);
    setShowUploader(false);
    // If signed in, keep the file in the account too (best effort, max 3).
    if (file) {
      void (async () => {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        try {
          await uploadCloudBook(file, book.title);
          window.dispatchEvent(new Event("pace:cloud-books-changed"));
        } catch {
          /* limit reached or offline — local copy still works */
        }
      })();
    }
    await openBook(entry.id, true);
  }

  function onPosition(p: number) {
    setActive((prev) => {
      if (!prev) return prev;
      // Persist every position tick so switching books is always clean.
      updateBookPosition(prev.id, p);
      return { ...prev, position: p };
    });
  }

  function closeReader() {
    if (active) updateBookPosition(active.id, active.position);
    setReading(false);
  }

  function toggleTheme(checked: boolean) {
    const next: Theme = checked ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <div className="min-h-screen pb-16">
      <header className="px-5 pt-8 pb-4">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-ember">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-[0.18em]">Pace</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sun className={`h-4 w-4 ${theme === "light" ? "text-ember" : ""}`} />
              <Switch
                checked={theme === "dark"}
                onCheckedChange={toggleTheme}
                aria-label="Toggle dark mode"
              />
              <Moon className={`h-4 w-4 ${theme === "dark" ? "text-ember" : ""}`} />
            </label>
          </div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink text-balance">
            Your reading library.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload as many books as you like — each keeps its own place and progress.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-5">
        <StatsBar />

        <Library activeId={activeId} onOpen={(id) => void openBook(id, true)} />

        {ready && (
          <section>
            {showUploader ? (
              <div className="space-y-2">
                <Uploader onLoaded={onUploaded} />
                <button
                  onClick={() => setShowUploader(false)}
                  className="text-xs text-muted-foreground hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowUploader(true)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-paper/60 px-4 py-4 text-sm font-medium text-muted-foreground transition-colors hover:border-ember/60 hover:text-ember"
              >
                <Plus className="h-4 w-4" />
                Add a book to your library
              </button>
            )}
          </section>
        )}

        <ProgressCalendar />

        <SyncPanel />

        <CloudBooksPanel onLoaded={(book) => void onUploaded(book)} />

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Your library and progress live only on this device. Works offline once installed.
        </footer>
      </main>

      {reading && active && (
        <SpeedReader
          key={active.id}
          book={active.book}
          position={active.position}
          onPosition={onPosition}
          onClose={closeReader}
        />
      )}
    </div>
  );
}
