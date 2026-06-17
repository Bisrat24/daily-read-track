import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
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

// Optical centering: pick the index of the focus letter (ORP-like).
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
  const startedAtRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const wordsSinceRecordRef = useRef(0);

  useEffect(() => setSettings(loadSettings()), []);
  const onPositionRef = useRef(onPosition);
  useEffect(() => { onPositionRef.current = onPosition; }, [onPosition]);
  useEffect(() => { onPositionRef.current(idx); }, [idx]);

  // Effective WPM ramps linearly from startWpm to targetWpm over rampMinutes.
  function currentWpm() {
    const { startWpm, targetWpm, rampMinutes } = settings;
    const startedAt = startedAtRef.current;
    if (!startedAt) return startWpm;
    const minutes = (Date.now() - startedAt) / 60_000;
    const t = Math.min(1, minutes / Math.max(0.1, rampMinutes));
    return Math.round(startWpm + (targetWpm - startWpm) * t);
  }

  const chunkSize = settings.mode === "rsvp" ? 1 : Math.max(1, settings.chunkSize);

  // Main tick loop
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

  // Chunk-mode rendering: a paragraph-style window with current chunk highlighted.
  const chunkWindow = useMemo(() => {
    if (settings.mode === "rsvp") return null;
    const windowSize = 60;
    const start = Math.max(0, idx - 25);
    const end = Math.min(book.words.length, start + windowSize);
    const slice = book.words.slice(start, end);
    return { start, end, slice };
  }, [idx, settings.mode, book.words]);

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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="rsvp">Flash (RSVP)</TabsTrigger>
            <TabsTrigger value="chunk">Highlight</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Reader stage */}
      <div className="flex flex-1 items-center justify-center px-6">
        {settings.mode === "rsvp" ? (
          <RsvpStage word={word} />
        ) : (
          <ChunkStage
            words={chunkWindow!.slice}
            start={chunkWindow!.start}
            currentIdx={idx}
            chunkSize={chunkSize}
          />
        )}
      </div>

      {/* Progress */}
      <div className="px-6">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-ember transition-[width] duration-200"
            style={{ width: `${(idx / Math.max(1, book.words.length - 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-5 p-6 pt-4">
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIdx((i) => Math.max(0, i - WORDS_PER_PAGE))}
            aria-label="Back one page"
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
            onClick={() => setIdx((i) => Math.min(book.words.length - 1, i + WORDS_PER_PAGE))}
            aria-label="Forward one page"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              startedAtRef.current = null;
              lastTickRef.current = 0;
            }}
            aria-label="Restart ramp"
          >
            <RotateCcw className="h-5 w-5" />
          </Button>
        </div>

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
          {settings.mode === "chunk" && (
            <SliderRow
              label="Chunk"
              value={settings.chunkSize}
              unit="words"
              min={1} max={5} step={1}
              onChange={(v) => update("chunkSize", v)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label, value, unit, min, max, step, onChange,
}: {
  label: string; value: number; unit: string;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink">{label}</span>
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

function ChunkStage({
  words, start, currentIdx, chunkSize,
}: { words: string[]; start: number; currentIdx: number; chunkSize: number }) {
  return (
    <p className="font-display text-xl leading-relaxed text-ink/80 max-w-prose">
      {words.map((w, i) => {
        const abs = start + i;
        const active = abs >= currentIdx && abs < currentIdx + chunkSize;
        return (
          <span
            key={i}
            className={
              active
                ? "rounded bg-ember/20 px-0.5 text-ink"
                : abs < currentIdx
                ? "text-muted-foreground/60"
                : ""
            }
          >
            {w}{" "}
          </span>
        );
      })}
    </p>
  );
}
