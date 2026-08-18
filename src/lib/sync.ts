// Optional cloud backup of reading progress.
// Everything still works offline and on-device; signing in just mirrors the
// stats calendar, reader settings, and per-book positions to the account so a
// second device (or a reinstall) can pick up where you left off.

import { supabase } from "@/integrations/supabase/client";
import { loadLibrary, saveLibrary, upsertRemoteBook } from "@/lib/library";
import {
  defaultSettings,
  loadSettings,
  loadStats,
  pagesFromWords,
  saveSettings,
  saveStats,
  wordsLastHour,
  wordsToday,
  type ReadingEvent,
  type Settings,
  type Stats,
} from "@/lib/stats";

export type SyncPayload = {
  version: 1;
  savedAt: number;
  stats: Stats;
  settings: Settings;
  /** Book titles + progress, keyed by title so they match across devices. */
  books: { title: string; wordCount: number; position: number; lastReadAt: number }[];
  /** Snapshot of the reading counters at backup time (display only). */
  totals?: {
    hourWords: number;
    hourPages: number;
    todayWords: number;
    todayPages: number;
  };
};

function deviceName() {
  if (typeof navigator === "undefined") return "device";
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/mac os/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  return "Browser";
}

export function buildPayload(): SyncPayload {
  const stats = loadStats();
  const hourWords = wordsLastHour(stats);
  const todayWords = wordsToday(stats);
  return {
    version: 1,
    savedAt: Date.now(),
    stats,
    settings: loadSettings(),
    books: loadLibrary().map((b) => ({
      title: b.title,
      wordCount: b.wordCount,
      position: b.position,
      lastReadAt: b.lastReadAt,
    })),
    totals: {
      hourWords,
      hourPages: pagesFromWords(hourWords),
      todayWords,
      todayPages: pagesFromWords(todayWords),
    },
  };
}


function mergeEvents(local: ReadingEvent[], remote: ReadingEvent[]): ReadingEvent[] {
  const seen = new Set(local.map((e) => `${e.at}:${e.words}`));
  const adds = remote.filter(
    (e) =>
      typeof e?.at === "number" &&
      typeof e?.words === "number" &&
      !seen.has(`${e.at}:${e.words}`),
  );
  return [...local, ...adds].sort((a, b) => a.at - b.at);
}

/** Merge a remote payload into local storage. Never loses local reading. */
export function applyPayload(payload: SyncPayload) {
  if (payload?.version !== 1) throw new Error("Unrecognised backup format.");

  saveStats({ events: mergeEvents(loadStats().events, payload.stats?.events ?? []) });
  if (payload.settings) saveSettings({ ...defaultSettings, ...payload.settings });

  // Per-book positions: keep whichever side was read most recently. Titles that
  // don't exist here yet are added as placeholders so the shelf matches across
  // devices; opening one just asks for the file.
  const local = loadLibrary();
  let changed = false;
  const newTitles: SyncPayload["books"] = [];
  for (const remote of payload.books ?? []) {
    const match = local.find((b) => b.title === remote.title);
    if (!match) {
      newTitles.push(remote);
      continue;
    }
    if ((remote.lastReadAt ?? 0) > (match.lastReadAt ?? 0)) {
      match.position = match.remote
        ? remote.position
        : Math.max(0, Math.min(remote.position, match.wordCount));
      match.lastReadAt = remote.lastReadAt;
      changed = true;
    }
  }
  if (changed) saveLibrary(local);
  for (const t of newTitles) {
    upsertRemoteBook({
      title: t.title,
      wordCount: t.wordCount ?? 0,
      position: t.position ?? 0,
      lastReadAt: t.lastReadAt ?? 0,
    });
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("pace:stats-changed"));
    window.dispatchEvent(new Event("pace:library-changed"));
  }
}


export async function pushProgress(userId: string) {
  const payload = buildPayload();
  const { error } = await supabase
    .from("reading_progress")
    .upsert(
      { user_id: userId, payload: payload as unknown as never, device: deviceName() },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
  return payload.savedAt;
}

export async function pullProgress() {
  const { data, error } = await supabase
    .from("reading_progress")
    .select("payload, device, updated_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.payload) return null;
  applyPayload(data.payload as unknown as SyncPayload);
  return { device: data.device as string | null, updatedAt: data.updated_at as string };
}

export async function fetchRemoteMeta() {
  const { data, error } = await supabase
    .from("reading_progress")
    .select("device, updated_at, payload")
    .maybeSingle();
  if (error || !data) return null;
  const payload = data.payload as unknown as SyncPayload | null;
  return {
    device: data.device as string | null,
    updated_at: data.updated_at as string,
    totals: payload?.totals ?? null,
    bookCount: payload?.books?.length ?? 0,
  };
}

// ---- Auto sync --------------------------------------------------------------
// Debounced background backup so progress, titles and the day's counters stay
// current on every signed-in device without the user pressing anything.

let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAutoPush(userId: string, delayMs = 10_000) {
  if (typeof window === "undefined") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void pushProgress(userId).catch(() => {});
  }, delayMs);
}

export function cancelAutoPush() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Wires change events → debounced push. Returns a cleanup function. */
export function startAutoSync(userId: string) {
  if (typeof window === "undefined") return () => {};
  const onChange = () => scheduleAutoPush(userId);
  const onHide = () => {
    if (document.visibilityState === "hidden") {
      cancelAutoPush();
      void pushProgress(userId).catch(() => {});
    }
  };
  window.addEventListener("pace:stats-changed", onChange);
  window.addEventListener("pace:library-changed", onChange);
  document.addEventListener("visibilitychange", onHide);
  return () => {
    cancelAutoPush();
    window.removeEventListener("pace:stats-changed", onChange);
    window.removeEventListener("pace:library-changed", onChange);
    document.removeEventListener("visibilitychange", onHide);
  };
}

