import { useRef, useState } from "react";
import { Upload, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseFile, type ParsedBook } from "@/lib/parsers";
import { idbGet, idbSet } from "@/lib/idb";

type CachedEntry = { key: string; book: ParsedBook; cachedAt: number };
const CACHE_KEY = "pace.recentBooks.v1";
const MAX_CACHED = 5;

function fileKey(f: File) {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

async function loadCache(): Promise<CachedEntry[]> {
  return (await idbGet<CachedEntry[]>(CACHE_KEY)) ?? [];
}

async function cacheBook(file: File, book: ParsedBook) {
  const key = fileKey(file);
  const list = await loadCache();
  const filtered = list.filter((e) => e.key !== key);
  filtered.unshift({ key, book, cachedAt: Date.now() });
  await idbSet(CACHE_KEY, filtered.slice(0, MAX_CACHED));
}

async function findCached(file: File): Promise<ParsedBook | null> {
  const key = fileKey(file);
  const list = await loadCache();
  return list.find((e) => e.key === key)?.book ?? null;
}

export function Uploader({ onLoaded }: { onLoaded: (book: ParsedBook) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handle(file: File) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const cached = await findCached(file);
      if (cached) {
        setStatus("Loaded from cache");
        onLoaded(cached);
        return;
      }
      setStatus("Parsing…");
      const book = await parseFile(file);
      if (!book.words.length) throw new Error("Couldn't extract any text from this file.");
      await cacheBook(file, book);
      onLoaded(book);
    } catch (e: any) {
      setError(e?.message ?? "Failed to read this file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handle(f);
        }}
        className={`relative grain block cursor-pointer rounded-2xl border-2 border-dashed bg-paper p-8 text-center transition-all ${
          dragOver ? "border-ember bg-accent/40" : "border-border hover:border-ember/60"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.epub,application/pdf,application/epub+zip"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handle(f);
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ember/15 text-ember">
            {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <Upload className="h-7 w-7" />}
          </div>
          <div>
            <p className="font-display text-xl font-semibold text-ink">
              {busy ? (status ?? "Reading your book…") : "Upload a book"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Drop a <span className="font-medium text-ink">PDF</span> or{" "}
              <span className="font-medium text-ink">EPUB</span>, or tap to browse
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              Recently opened books are cached locally — reopening is instant and works offline.
            </p>
          </div>
          <Button
            type="button"
            disabled={busy}
            onClick={(e) => { e.preventDefault(); inputRef.current?.click(); }}
            className="mt-2 gap-2 bg-ember text-ember-foreground hover:bg-ember/90"
          >
            <FileText className="h-4 w-4" /> Choose file
          </Button>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      </label>
    </div>
  );
}
