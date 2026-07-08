import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  Settings2,
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
import { startMediaWakeLock, stopMediaWakeLock } from "@/lib/mediaWakeLock";

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

// Rough syllable count — good enough for pacing heuristics.
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const cleaned = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = cleaned.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

export function SpeedReader({ book, position, onPosition, onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(position);
  const [pageInput, setPageInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const wordsSinceRecordRef = useRef(0);
  // Persistent wake lock sentinel — never cleared by re-renders/timer updates.
  const wakeLockRef = useRef<any>(null);
  const wakeLockWantedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeWordRef = useRef<HTMLSpanElement | null>(null);
  // Track current playing state without subscribing visibility handler to re-renders.
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => setSettings(loadSettings()), []);
  const onPositionRef = useRef(onPosition);
  useEffect(() => { onPositionRef.current = onPosition; }, [onPosition]);
  useEffect(() => { onPositionRef.current(idx); }, [idx]);

  // --- Wake Lock helpers ------------------------------------------------------
  // Acquire is called DIRECTLY from the Play onClick handler (user gesture),
  // which Opera / Chromium require. We never re-acquire from state effects
  // while playing, so timer/slider re-renders can't drop the lock.
  const acquireWakeLock = useCallback(async () => {
    wakeLockWantedRef.current = true;
    startMediaWakeLock({ title: book.title || "Speed Reader", artist: "Pace" });
    setWakeLockActive(true);
    try {
      const wl: any = (navigator as any).wakeLock;
      if (!wl?.request) return;
      if (wakeLockRef.current) return;
      const lock = await wl.request("screen");
      wakeLockRef.current = lock;
      lock.addEventListener?.("release", () => {
        wakeLockRef.current = null;
        if (!wakeLockWantedRef.current) setWakeLockActive(false);
      });
    } catch {
      /* ignore */
    }
  }, [book.title]);

  const releaseWakeLock = useCallback(() => {
    wakeLockWantedRef.current = false;
    stopMediaWakeLock();
    try { wakeLockRef.current?.release?.(); } catch { /* ignore */ }
    wakeLockRef.current = null;
    setWakeLockActive(false);
  }, []);

  // Auto-pause when hidden (if enabled) and re-acquire wake lock when visible again.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (playingRef.current && settings.autoPauseOnHide) {
          flushRecord();
          releaseWakeLock();
          setPlaying(false);
        }
      } else if (
        wakeLockWantedRef.current &&
        !wakeLockRef.current
      ) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      releaseWakeLock();
    };
  }, [acquireWakeLock, releaseWakeLock, settings.autoPauseOnHide]);

  function currentWpm() {
    const { startWpm, targetWpm, rampMinutes } = settings;
    const startedAt = startedAtRef.current;
    if (!startedAt) return startWpm;
    const minutes = (Date.now() - startedAt) / 60_000;
    const t = Math.min(1, minutes / Math.max(0.1, rampMinutes));
    return Math.round(startWpm + (targetWpm - startWpm) * t);
  }

  const chunkSize = settings.mode === "rsvp" ? 1 : Math.max(1, settings.chunkSize);

  // Dynamic pacing multiplier based on the current chunk's content:
  // - trailing punctuation → natural cognitive pause
  // - long / syllable-heavy words → extra dwell time
  function pacingMultiplierFor(startIdx: number, size: number) {
    let mult = 1;
    for (let k = 0; k < size; k++) {
      const w = book.words[startIdx + k];
      if (!w) break;
      // Collapse trailing punctuation cluster (e.g. "......" or "?!") into a
      // single representative mark so ellipses don't compound multipliers.
      const trailMatch = w.trim().match(/[.!?;:,]+$/);
      if (trailMatch) {
        const unique = new Set(trailMatch[0].split(""));
        if (unique.has(".") || unique.has("!") || unique.has("?")) mult *= 1.3;
        else if (unique.has(";") || unique.has(":")) mult *= 1.2;
        else if (unique.has(",")) mult *= 1.1;
      }

      // Long / syllable-heavy words
      const core = w.replace(/[^A-Za-z]/g, "");
      if (core.length >= 10) mult *= 1.35;
      else if (core.length >= 7) mult *= 1.15;
      const syllables = countSyllables(core);
      if (syllables >= 7) mult *= 1.1;
      else if (syllables >= 6) mult *= 1.05;
    }
    return Math.min(mult, 3);
  }

  useEffect(() => {
    if (!playing) return;
    if (!startedAtRef.current) startedAtRef.current = Date.now();
    let raf = 0;
    const step = (t: number) => {
      const wpm = currentWpm();
      const msPerWord = 60_000 / Math.max(60, wpm);
      const mult = pacingMultiplierFor(idx, chunkSize);
      const advanceMs = msPerWord * chunkSize * mult;
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
  }, [playing, chunkSize, idx, settings.startWpm, settings.targetWpm, settings.rampMinutes, book.words.length]);

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

  const WINDOW_SIZE = 1200;
  const [windowStart, setWindowStart] = useState(() => Math.max(0, position - 200));
  useEffect(() => {
    if (settings.mode === "rsvp") return;
    if (idx < windowStart + 100 || idx > windowStart + WINDOW_SIZE - 200) {
      setWindowStart(Math.max(0, idx - 200));
    }
  }, [idx, settings.mode, windowStart]);

  // Smoothly keep the active word near the upper-third of the reader viewport.
  useEffect(() => {
    if (settings.mode === "rsvp") return;
    const container = scrollRef.current;
    const el = activeWordRef.current;
    if (!container || !el) return;
    const target = el.offsetTop - container.clientHeight * 0.32;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [idx, settings.mode]);

  const chunkWindow = useMemo(() => {
    if (settings.mode === "rsvp") return null;
    const end = Math.min(book.words.length, windowStart + WINDOW_SIZE);
    const slice = book.words.slice(windowStart, end);
    return { start: windowStart, end, slice };
  }, [windowStart, settings.mode, book.words]);

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

  // Play button handler — acquires wake lock inline in the user gesture.
  function handlePlayClick() {
    const nextPlaying = !playing;
    if (nextPlaying) {
      // Rollback a few words on resume so the reader regains context.
      const wpmNow = currentWpm();
      const rollback = Math.max(10, Math.round(wpmNow / 30));
      setIdx((i) => Math.max(0, i - rollback));
      // Fire-and-forget INSIDE the click event to satisfy Opera's gesture check.
      acquireWakeLock();
      if (!startedAtRef.current) startedAtRef.current = Date.now();
    } else {
      flushRecord();
      releaseWakeLock();
    }
    setPlaying(nextPlaying);
    lastTickRef.current = 0;
  }

  const immersive = playing && settings.mode !== "rsvp";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header — hidden in immersive reading */}
      {!immersive && (
        <div className="flex items-center justify-between border-b border-border bg-paper/80 px-4 py-3 backdrop-blur">
          <button
            onClick={() => { flushRecord(); releaseWakeLock(); onClose(); }}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
            aria-label="Close reader"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="text-center">
            <p className="font-display text-sm font-semibold text-ink truncate max-w-[180px]">
              {book.title}
            </p>
            <p className="text-[11px] text-muted-foreground flex items-center justify-center gap-1.5">
              <span>Page {pageNum} / {totalPages} · {wpm} wpm</span>
              <span
                title={wakeLockActive ? "Screen wake lock active" : "Wake lock idle"}
                aria-label={wakeLockActive ? "Wake lock on" : "Wake lock off"}
                className={[
                  "inline-block h-1.5 w-1.5 rounded-full",
                  wakeLockActive ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" : "bg-muted-foreground/40",
                ].join(" ")}
              />
            </p>
          </div>
          <div className="w-9" />
        </div>
      )}

      {/* Mode toggle — hidden in immersive */}
      {!immersive && (
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
      )}

      {/* Reader stage — expands to fill screen in Highlight/Bionic */}
      <div
        ref={scrollRef}
        className={[
          "flex flex-1 overflow-y-auto",
          settings.mode === "rsvp"
            ? "items-center justify-center px-6 py-4"
            : "flex-col items-stretch px-5 sm:px-8 py-6",
        ].join(" ")}
      >
        {settings.mode === "rsvp" ? (
          <RsvpStage word={word} />
        ) : settings.mode === "bionic" ? (
          <BionicStage
            words={chunkWindow!.slice}
            start={chunkWindow!.start}
            currentIdx={idx}
            chunkSize={chunkSize}
            boldPct={settings.bionicBoldPct}
            activeRef={activeWordRef}
          />
        ) : (
          <ChunkStage
            words={chunkWindow!.slice}
            start={chunkWindow!.start}
            currentIdx={idx}
            chunkSize={chunkSize}
            activeRef={activeWordRef}
          />
        )}
      </div>

      {/* Floating pause button — only visible in immersive mode */}
      {immersive && (
        <>
          <button
            onClick={handlePlayClick}
            aria-label="Pause"
            className="fixed bottom-6 right-6 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-ember/90 text-ember-foreground shadow-lg backdrop-blur transition-colors hover:bg-ember"
          >
            <Pause className="h-6 w-6" />
          </button>
          <button
            onClick={() => { flushRecord(); releaseWakeLock(); onClose(); }}
            aria-label="Close reader"
            className="fixed top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-background/70 text-muted-foreground shadow backdrop-blur hover:bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Seek slider + controls — hidden in immersive */}
      {!immersive && (
        <>
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

          <div className="space-y-5 p-6 pt-4">
            {/* Transport */}
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="icon" onClick={() => step(-WORDS_PER_PAGE)} aria-label="Back one page">
                <ChevronsLeft className="h-5 w-5" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => step(-chunkSize)} aria-label="Back">
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                size="lg"
                onClick={handlePlayClick}
                className="h-14 w-14 rounded-full bg-ember p-0 text-ember-foreground hover:bg-ember/90"
              >
                {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 translate-x-0.5" />}
              </Button>
              <Button variant="outline" size="icon" onClick={() => step(chunkSize)} aria-label="Forward">
                <ChevronRight className="h-5 w-5" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => step(WORDS_PER_PAGE)} aria-label="Forward one page">
                <ChevronsRight className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { startedAtRef.current = null; lastTickRef.current = 0; }}
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
                if (Number.isFinite(n)) { jumpToPage(n); setPageInput(""); }
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

            {/* Collapsible settings */}
            <div className="rounded-2xl border border-border bg-card/60">
              <button
                type="button"
                onClick={() => setPanelOpen((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink"
              >
                <span className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4" /> Reading settings
                </span>
                <span className="text-xs text-muted-foreground">{panelOpen ? "Hide" : "Show"}</span>
              </button>
              {panelOpen && (
                <div className="space-y-4 border-t border-border/60 p-4">
                  <SliderRow label="Start" value={settings.startWpm} unit="wpm" min={120} max={600} step={10} onChange={(v) => update("startWpm", v)} />
                  <SliderRow label="Target" value={settings.targetWpm} unit="wpm" min={150} max={900} step={10} onChange={(v) => update("targetWpm", v)} />
                  <SliderRow label="Ramp" value={settings.rampMinutes} unit="min" min={1} max={60} step={1} onChange={(v) => update("rampMinutes", v)} />
                  <SliderRow
                    label="Chunk" value={settings.chunkSize} unit="words"
                    min={1} max={6} step={1}
                    onChange={(v) => update("chunkSize", v)}
                    hint={settings.mode === "rsvp" ? "Used in Highlight/Bionic mode" : undefined}
                  />
                  {settings.mode === "bionic" && (
                    <SliderRow label="Bionic bold" value={settings.bionicBoldPct} unit="%" min={20} max={60} step={5} onChange={(v) => update("bionicBoldPct", v)} />
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
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
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
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
  words, start, currentIdx, chunkSize, activeRef,
}: {
  words: string[]; start: number; currentIdx: number; chunkSize: number;
  activeRef: React.MutableRefObject<HTMLSpanElement | null>;
}) {
  return (
    <p className="font-display text-left text-xl sm:text-2xl leading-relaxed text-ink/80 w-full max-w-prose mx-auto">
      {words.map((w, i) => {
        const abs = start + i;
        const isFirstActive = abs === currentIdx;
        const active = abs >= currentIdx && abs < currentIdx + chunkSize;
        const past = abs < currentIdx;
        return (
          <span
            key={i}
            ref={isFirstActive ? activeRef : undefined}
            className={[
              "rounded px-0.5 transition-colors",
              active ? "bg-ember/25 text-ink" : past ? "bg-transparent text-muted-foreground/60" : "bg-transparent",
            ].join(" ")}
          >
            {w}{" "}
          </span>
        );
      })}
    </p>
  );
}

function BionicStage({
  words, start, currentIdx, chunkSize, boldPct, activeRef,
}: {
  words: string[]; start: number; currentIdx: number; chunkSize: number; boldPct: number;
  activeRef: React.MutableRefObject<HTMLSpanElement | null>;
}) {
  // Long words: 40–50% of letters (slider-controlled). Short words (<4): 1 letter.
  const frac = Math.max(0.4, Math.min(0.5, boldPct / 100));
  return (
    <p
      className="font-display text-left text-xl sm:text-2xl leading-relaxed text-ink w-full max-w-prose mx-auto"
      style={{ fontVariantLigatures: "none", fontKerning: "none" }}
    >
      {words.map((w, i) => {
        const abs = start + i;
        const isFirstActive = abs === currentIdx;
        const active = abs >= currentIdx && abs < currentIdx + chunkSize;
        const past = abs < currentIdx;
        const match = w.match(/^(\W*)(\w+)?([\s\S]*)$/);
        const lead = match?.[1] ?? "";
        const core = match?.[2] ?? "";
        const tail = match?.[3] ?? "";
        const boldLen = core
          ? core.length < 4
            ? 1
            : Math.max(1, Math.round(core.length * frac))
          : 0;
        const boldPart = core.slice(0, boldLen);
        const restPart = core.slice(boldLen);
        // Future (unread) text is heavily dimmed; past text is muted; active is bright.
        const dimClass = active
          ? "text-ink"
          : past
          ? "text-muted-foreground/60"
          : "text-muted-foreground/35";
        return (
          <span
            key={i}
            ref={isFirstActive ? activeRef : undefined}
            className={[
              "rounded px-0.5 transition-colors",
              active
                ? "bg-ember/30 text-ink ring-1 ring-ember/50 shadow-[0_0_0_2px_rgba(0,0,0,0.02)]"
                : past
                ? "text-muted-foreground/70"
                : "",
            ].join(" ")}
          >
            {lead && <span className={dimClass}>{lead}</span>}
            {boldPart && (
              <strong className="font-bold text-ink">{boldPart}</strong>
            )}
            {restPart && <span className={dimClass}>{restPart}</span>}
            {tail && <span className={dimClass}>{tail}</span>}
            {" "}
          </span>
        );
      })}
    </p>
  );
}
