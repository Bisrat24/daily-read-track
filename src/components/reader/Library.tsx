import { useEffect, useState } from "react";
import { BookOpen, Play, Trash2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteBook,
  loadLibrary,
  renameBook,
  type LibraryBook,
} from "@/lib/library";

type Props = {
  activeId: string | null;
  onOpen: (id: string) => void;
};

export function Library({ activeId, onOpen }: Props) {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const refresh = () => setBooks(loadLibrary());
    refresh();
    window.addEventListener("pace:library-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("pace:library-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (!books.length) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Your library</h2>
        <span className="text-xs text-muted-foreground">{books.length} book{books.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="space-y-2">
        {books.map((b) => {
          const pct = b.wordCount ? Math.round((b.position / b.wordCount) * 100) : 0;
          const isActive = b.id === activeId;
          const isEditing = editingId === b.id;
          return (
            <li
              key={b.id}
              className={`rounded-2xl border p-3 transition-colors ${
                isActive ? "border-ember/60 bg-ember/5" : "border-border bg-card/60"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ember/15 text-ember">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { renameBook(b.id, draft); setEditingId(null); }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="h-8"
                      />
                      <Button size="icon" variant="ghost" onClick={() => { renameBook(b.id, draft); setEditingId(null); }} aria-label="Save">
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onOpen(b.id)}
                        className="min-w-0 flex-1 truncate text-left font-display text-base font-semibold text-ink hover:text-ember"
                      >
                        {b.title}
                      </button>
                      {isActive && (
                        <span className="rounded-full bg-ember/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ember">
                          Active
                        </span>
                      )}
                    </div>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {pct}% · {b.position.toLocaleString()} / {b.wordCount.toLocaleString()} words
                  </p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-ember" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      onClick={() => onOpen(b.id)}
                      className="h-8 gap-1.5 bg-ember text-ember-foreground hover:bg-ember/90"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {b.position > 0 ? "Continue" : "Start"}
                    </Button>
                    {!isEditing && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => { setEditingId(b.id); setDraft(b.title); }}
                        aria-label="Rename"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Remove "${b.title}" from your library?`)) {
                          void deleteBook(b.id);
                        }
                      }}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
