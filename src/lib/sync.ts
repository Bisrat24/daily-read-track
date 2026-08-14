// Optional cloud backup of reading progress.
// Everything still works offline and on-device; signing in just mirrors the
// stats calendar, reader settings, and per-book positions to the account so a
// second device (or a reinstall) can pick up where you left off.

import { supabase } from "@/integrations/supabase/client";
import { loadLibrary, saveLibrary } from "@/lib/library";
import {
  defaultSettings,
  loadSettings,
  loadStats,
  saveSettings,
  saveStats,
  type ReadingEvent,
  type Settings,
  type Stats,
} from "@/lib/stats";

export type SyncPayload = {
  version: 1;
  savedAt: number;
  stats: Stats;
  settings: Settings;
  /** Book positions keyed by title so they match across devices. */
  books: { title: string; wordCount: number; position: number; lastReadAt: number }[];
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
  return {
    version: 1,
    savedAt: Date.now(),
    stats: loadStats(),
    settings: loadSettings(),
    books: loadLibrary().map((b) => ({
      title: b.title,
      wordCount: b.wordCount,
      position: b.position,
      lastReadAt: b.lastReadAt,
    })),
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

  // Per-book positions: keep whichever side was read most recently.
  const local = loadLibrary();
  let changed = false;
  for (const remote of payload.books ?? []) {
    const match = local.find((b) => b.title === remote.title);
    if (!match) continue;
    if ((remote.lastReadAt ?? 0) > (match.lastReadAt ?? 0)) {
      match.position = Math.max(0, Math.min(remote.position, match.wordCount));
      match.lastReadAt = remote.lastReadAt;
      changed = true;
    }
  }
  if (changed) saveLibrary(local);
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
    .select("device, updated_at")
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}
