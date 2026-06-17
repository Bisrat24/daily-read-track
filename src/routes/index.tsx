import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookMarked, Sparkles, Play, Trash2 } from "lucide-react";
import { Uploader } from "@/components/reader/Uploader";
import { SpeedReader } from "@/components/reader/SpeedReader";
import { StatsBar } from "@/components/reader/StatsBar";
import { ProgressCalendar } from "@/components/reader/ProgressCalendar";
import { Button } from "@/components/ui/button";
import { BOOK_KEY } from "@/lib/stats";
import type { ParsedBook } from "@/lib/parsers";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pace — Train your reading speed" },
      { name: "description", content: "Upload a PDF or EPUB, start at your comfortable pace and ramp up. Track pages and words on a daily calendar." },
      { property: "og:title", content: "Pace — Train your reading speed" },
      { property: "og:description", content: "Upload a PDF or EPUB, start at your comfortable pace and ramp up. Track pages and words on a daily calendar." },
    ],
  }),
  component: Index,
  ssr: false,
});

type SavedBook = { book: ParsedBook; position: number };

function loadSavedBook(): SavedBook | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BOOK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedBook;
  } catch {
    return null;
  }
}

function saveSavedBook(s: SavedBook | null) {
  if (typeof window === "undefined") return;
  if (!s) localStorage.removeItem(BOOK_KEY);
  else localStorage.setItem(BOOK_KEY, JSON.stringify(s));
}

function Index() {
  const [saved, setSaved] = useState<SavedBook | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    setSaved(loadSavedBook());
  }, []);

  function onLoaded(book: ParsedBook) {
    const s = { book, position: 0 };
    setSaved(s);
    saveSavedBook(s);
    setReading(true);
  }

  function onPosition(p: number) {
    if (!saved) return;
    const next = { ...saved, position: p };
    setSaved(next);
    saveSavedBook(next);
  }

  function removeBook() {
    setSaved(null);
    saveSavedBook(null);
  }

  return (
    <div className="min-h-screen pb-16">
      <header className="px-5 pt-8 pb-4">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-2 text-ember">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-[0.18em]">Pace</span>
          </div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink text-balance">
            Read faster, one page at a time.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Start at a comfortable speed, ramp up to your target, and watch the days fill in.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-5">
        <StatsBar />

        {saved ? (
          <section className="relative overflow-hidden rounded-2xl border border-border bg-card/70 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ember/15 text-ember">
                <BookMarked className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Currently reading</p>
                <h2 className="font-display text-lg font-semibold text-ink truncate">{saved.book.title}</h2>
                <p className="text-xs text-muted-foreground">
                  {Math.round((saved.position / Math.max(1, saved.book.words.length)) * 100)}% complete
                  {" · "}
                  {saved.book.words.length.toLocaleString()} words
                </p>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-ember"
                    style={{ width: `${(saved.position / Math.max(1, saved.book.words.length)) * 100}%` }}
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={() => setReading(true)}
                    className="gap-2 bg-ember text-ember-foreground hover:bg-ember/90"
                  >
                    <Play className="h-4 w-4" /> Continue
                  </Button>
                  <Button variant="ghost" size="icon" onClick={removeBook} aria-label="Remove book">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <Uploader onLoaded={onLoaded} />
        )}

        {saved && (
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-ink">
              Upload a different book
            </summary>
            <div className="mt-3">
              <Uploader onLoaded={onLoaded} />
            </div>
          </details>
        )}

        <ProgressCalendar />

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Your books and progress are stored only on this device.
        </footer>
      </main>

      {reading && saved && (
        <SpeedReader
          book={saved.book}
          position={saved.position}
          onPosition={onPosition}
          onClose={() => setReading(false)}
        />
      )}
    </div>
  );
}
