import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  CornerDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  loadSettings,
  saveSettings,
  defaultSettings,
  recordWords,
  WORDS_PER_PAGE,
  type Settings,
} from "@/lib/stats";
import type { ParsedBook } from "@/lib/parsers";

type Props = {
  book: ParsedBook;
  position: number;
  onPosition: (p: number) => void;
  onClose: () => void;
};

function focusIndex(word: string) {
  const len = word.length;
  if (len <= 1) return 0;
  if (len <= 3) return 1;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  return 3;
}

export function SpeedReader({ book, position, onPosition, onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(position);
  const [pageInput, setPageInput] = useState("");
  const startedAtRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const wordsSinceRecordRef = useRef(0);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => setSettings(loadSettings()), []);
  const onPositionRef = useRef(onPosition);
  useEffect(() => { onPositionRef.current = onPosition; }, [onPosition]);
  useEffect(() => { onPositionRef.current(idx); }, [idx]);

  // --- Screen Wake Lock: acquire ONLY while actively playing ------------------
  useEffect(() => {
    if (!playing) {
      try { wakeLockRef.current?.release?.(); } catch { /* ignore */ }
      wakeLockRef.current = null;
      return;
    }
    let cancelled = false;
    async function request() {
      try {
        const wl: any = (navigator as any).wakeLock;
        if (!wl?.request) return;
        const lock = await wl.request("screen");
        if (cancelled) {
          try { lock.release?.(); } catch { /* ignore */ }
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener?.("release", () => {
          wakeLockRef.current = null;
        });
      } catch {
        /* user gesture / permission — ignore */
      }
    }
    request();
    const onVis = () => {
      if (document.visibilityState === "visible" && playing && !wakeLockRef.current) request();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      try { wakeLockRef.current?.release?.(); } catch { /* ignore */ }
      wakeLockRef.current = null;
    };
  }, [playing]);

  function currentWpm() {
    const { startWpm, targetWpm, rampMinutes } = settings;
    const startedAt = startedAtRef.current;
    if (!startedAt) return startWpm;
    const minutes = (Date.now() - startedAt) / 60_000;
    const t = Math.min(1, minutes / Math.max(0.1, rampMinutes));
    return Math.round(startWpm + (targetWpm - startWpm) * t);
  }

  const chunkSize = settings.mode === "rsvp" ? 1 : Math.max(1, settings.chunkSize);

  useEffect(() => {
    if (!playing) return;
    if (!startedAtRef.current) startedAtRef.current = Date.now();
    let raf = 0;
    const step = (t: number) => {
      const wpm = currentWpm();
      const msPerWord = 60_000 / Math.max(60, wpm);
      const advanceMs = msPerWord * chunkSize;
      if (!lastTickRef.current) lastTickRef.current = t;
      if (t - lastTickRef.current >= advanceMs) {
        lastTickRef.current = t;
        setIdx((i) => {
          const next = i + chunkSize;
          if (next >= book.words.length) {
            setPlaying(false);
            flushRecord();
            return book.words.length - 1;
          }
          wordsSinceRecordRef.current += chunkSize;
          if (wordsSinceRecordRef.current >= 25) flushRecord();
          return next;
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, chunkSize, settings.startWpm, settings.targetWpm, settings.rampMinutes, book.words.length]);

  function flushRecord() {
    if (wordsSinceRecordRef.current > 0) {
      recordWords(wordsSinceRecordRef.current);
      wordsSinceRecordRef.current = 0;
      window.dispatchEvent(new Event("pace:stats-changed"));
    }
  }

  useEffect(() => {
    return () => flushRecord();
  }, []);

  function update<K extends keyof Settings>(k: K, v: Settings[K]) {
    const next = { ...settings, [k]: v };
    setSettings(next);
    saveSettings(next);
  }

  const word = book.words[idx] ?? "";
  const wpm = currentWpm();
  const pageNum = Math.floor(idx / WORDS_PER_PAGE) + 1;
  const totalPages = Math.max(1, Math.ceil(book.words.length / WORDS_PER_PAGE));

  const chunkWindow = useMemo(() => {
    if (settings.mode === "rsvp") return null;
    const windowSize = settings.mode === "bionic" ? 120 : 60;
    const start = Math.max(0, idx - 25);
    const end = Math.min(book.words.length, start + windowSize);
    const slice = book.words.slice(start, end);
    return { start, end, slice };
  }, [idx, settings.mode, book.words]);

  function jumpToPage(p: number) {
    const clamped = Math.max(1, Math.min(totalPages, Math.floor(p)));
    setIdx((clamped - 1) * WORDS_PER_PAGE);
    lastTickRef.current = 0;
  }

  function step(delta: number) {
    setIdx((i) => Math.max(0, Math.min(book.words.length - 1, i + delta)));
    lastTickRef.current = 0;
  }

  function seekTo(wordIndex: number) {
    const clamped = Math.max(0, Math.min(book.words.length - 1, Math.floor(wordIndex)));
    setIdx(clamped);
    lastTickRef.current = 0;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-paper/80 px-4 py-3 backdrop-blur">
        <button
          onClick={() => { flushRecord(); onClose(); }}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
          aria-label="Close reader"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="font-display text-sm font-semibold text-ink truncate max-w-[180px]">
            {book.title}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Page {pageNum} / {totalPages} · {wpm} wpm
          </p>
        </div>
        <div className="w-9" />
      </div>

      {/* Mode toggle */}
      <div className="px-4 pt-4">
        <Tabs
          value={settings.mode}
          onValueChange={(v) => update("mode", v as Settings["mode"])}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="rsvp">Flash</TabsTrigger>
            <TabsTrigger value="chunk">Highlight</TabsTrigger>
            <TabsTrigger value="bionic">Bionic</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Reader stage */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-4">
        {settings.mode === "rsvp" ? (
          <RsvpStage word={word} />
        ) : settings.mode === "bionic" ? (
          <BionicStage
            words={chunkWindow!.slice}
            start={chunkWindow!.start}
            currentIdx={idx}
            chunkSize={chunkSize}
            boldPct={settings.bionicBoldPct}
          />
        ) : (
          <ChunkStage
            words={chunkWindow!.slice}
            start={chunkWindow!.start}
            currentIdx={idx}
            chunkSize={chunkSize}
          />
        )}
      </div>

      {/* Seek slider (drag to any position) */}
      <div className="space-y-1.5 px-6">
        <Slider
          value={[idx]}
          min={0}
          max={Math.max(1, book.words.length - 1)}
          step={1}
          onValueChange={([v]) => seekTo(v)}
          aria-label="Seek position"
        />
        <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>Page {pageNum} of {totalPages}</span>
          <span>{Math.round((idx / Math.max(1, book.words.length - 1)) * 100)}%</span>
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-5 p-6 pt-4">
        {/* Transport: page back · chunk back · play · chunk fwd · page fwd · restart */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => step(-WORDS_PER_PAGE)}
            aria-label="Back one page"
            title="Back one page"
          >
            <ChevronsLeft className="h-5 w-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => step(-chunkSize)}
            aria-label="Back"
            title={`Back ${chunkSize} word${chunkSize > 1 ? "s" : ""}`}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            size="lg"
            onClick={() => {
              if (playing) flushRecord();
              setPlaying((p) => !p);
              lastTickRef.current = 0;
              if (!playing && !startedAtRef.current) startedAtRef.current = Date.now();
            }}
            className="h-14 w-14 rounded-full bg-ember p-0 text-ember-foreground hover:bg-ember/90"
          >
            {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => step(chunkSize)}
            aria-label="Forward"
            title={`Forward ${chunkSize} word${chunkSize > 1 ? "s" : ""}`}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => step(WORDS_PER_PAGE)}
            aria-label="Forward one page"
            title="Forward one page"
          >
            <ChevronsRight className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              startedAtRef.current = null;
              lastTickRef.current = 0;
            }}
            aria-label="Restart ramp"
            title="Restart speed ramp"
          >
            <RotateCcw className="h-5 w-5" />
          </Button>
        </div>

        {/* Jump-to-page */}
        <form
          className="flex items-center justify-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(pageInput, 10);
            if (Number.isFinite(n)) {
              jumpToPage(n);
              setPageInput("");
            }
          }}
        >
          <label className="text-xs text-muted-foreground">Jump to page</label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={totalPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            placeholder={String(pageNum)}
            className="h-8 w-20 text-center"
          />
          <Button type="submit" size="sm" variant="outline" className="h-8 gap-1">
            <CornerDownRight className="h-3.5 w-3.5" /> Go
          </Button>
        </form>

        <div className="space-y-4 rounded-2xl border border-border bg-card/60 p-4">
          <SliderRow
            label="Start"
            value={settings.startWpm}
            unit="wpm"
            min={120} max={600} step={10}
            onChange={(v) => update("startWpm", v)}
          />
          <SliderRow
            label="Target"
            value={settings.targetWpm}
            unit="wpm"
            min={150} max={900} step={10}
            onChange={(v) => update("targetWpm", v)}
          />
          <SliderRow
            label="Ramp"
            value={settings.rampMinutes}
            unit="min"
            min={1} max={60} step={1}
            onChange={(v) => update("rampMinutes", v)}
          />
          <SliderRow
            label="Chunk"
            value={settings.chunkSize}
            unit="words"
            min={1} max={6} step={1}
            onChange={(v) => update("chunkSize", v)}
            hint={settings.mode === "rsvp" ? "Used in Highlight/Bionic mode" : undefined}
          />
          {settings.mode === "bionic" && (
            <SliderRow
              label="Bionic bold"
              value={settings.bionicBoldPct}
              unit="%"
              min={20} max={60} step={5}
              onChange={(v) => update("bionicBoldPct", v)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label, value, unit, min, max, step, onChange, hint,
}: {
  label: string; value: number; unit: string;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink">
          {label}
          {hint && <span className="ml-2 text-[11px] font-normal text-muted-foreground">{hint}</span>}
        </span>
        <span className="font-mono text-sm tabular-nums text-muted-foreground">
          {value} <span className="text-xs">{unit}</span>
        </span>
      </div>
      <Slider
        value={[value]}
        min={min} max={max} step={step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

function RsvpStage({ word }: { word: string }) {
  const fi = focusIndex(word);
  const before = word.slice(0, fi);
  const focus = word.charAt(fi);
  const after = word.slice(fi + 1);
  return (
    <div className="relative w-full max-w-xl">
      <div className="pointer-events-none absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-ember/60" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-3 w-px -translate-x-1/2 bg-ember/60" />
      <div className="font-display text-5xl sm:text-6xl font-medium tracking-tight text-ink">
        <div className="grid grid-cols-[1fr_auto_1fr] items-baseline">
          <span className="text-right tabular-nums">{before}</span>
          <span className="reader-focus-letter px-[1px]">{focus || "\u00A0"}</span>
          <span className="text-left tabular-nums">{after}</span>
        </div>
      </div>
    </div>
  );
}

// Highlight mode — layout-stable: every word gets identical box (padding,
// border-radius, transparent background). Only the background color changes
// when a word becomes active, so surrounding text never shifts.
function ChunkStage({
  words, start, currentIdx, chunkSize,
}: { words: string[]; start: number; currentIdx: number; chunkSize: number }) {
  return (
    <p className="font-display text-xl leading-relaxed text-ink/80 max-w-prose">
      {words.map((w, i) => {
        const abs = start + i;
        const active = abs >= currentIdx && abs < currentIdx + chunkSize;
        const past = abs < currentIdx;
        return (
          <span
            key={i}
            className={[
              "rounded px-0.5 transition-colors",
              active
                ? "bg-ember/25 text-ink"
                : past
                ? "bg-transparent text-muted-foreground/60"
                : "bg-transparent",
            ].join(" ")}
          >
            {w}{" "}
          </span>
        );
      })}
    </p>
  );
}

// Bionic reading — bold the first N% of every word to guide the eye.
// Layout-stable: identical padding/box on every word.
function BionicStage({
  words, start, currentIdx, chunkSize, boldPct,
}: {
  words: string[]; start: number; currentIdx: number; chunkSize: number; boldPct: number;
}) {
  const frac = Math.max(0.1, Math.min(0.9, boldPct / 100));
  return (
    <p className="font-display text-xl leading-relaxed text-ink max-w-prose">
      {words.map((w, i) => {
        const abs = start + i;
        const active = abs >= currentIdx && abs < currentIdx + chunkSize;
        const past = abs < currentIdx;
        // Split on the leading letter run so punctuation doesn't count toward bold length.
        const match = w.match(/^(\W*)(\w+)?([\s\S]*)$/);
        const lead = match?.[1] ?? "";
        const core = match?.[2] ?? "";
        const tail = match?.[3] ?? "";
        const boldLen = core ? Math.max(1, Math.ceil(core.length * frac)) : 0;
        const boldPart = core.slice(0, boldLen);
        const restPart = core.slice(boldLen);
        return (
          <span
            key={i}
            className={[
              "rounded px-0.5 transition-colors",
              active ? "bg-ember/25" : past ? "text-muted-foreground/70" : "",
            ].join(" ")}
          >
            {lead}
            <span className="font-bold text-ink">{boldPart}</span>
            <span>{restPart}</span>
            {tail}{" "}
          </span>
        );
      })}
    </p>
  );
}
