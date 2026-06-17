// Local-only progress tracking via localStorage.
// "Pages" are normalized to 250 words for consistent cross-format counting.

export const WORDS_PER_PAGE = 250;
export const STORAGE_KEY = "pace.stats.v1";
export const SETTINGS_KEY = "pace.settings.v1";
export const BOOK_KEY = "pace.book.v1";

export type ReadingEvent = {
  at: number; // epoch ms
  words: number;
};

export type Stats = {
  events: ReadingEvent[];
};

export type Settings = {
  startWpm: number;
  targetWpm: number;
  rampMinutes: number; // time to ramp from start to target
  mode: "rsvp" | "chunk";
  chunkSize: number; // words shown together in chunk mode
};

export const defaultSettings: Settings = {
  startWpm: 200,
  targetWpm: 450,
  rampMinutes: 15,
  mode: "rsvp",
  chunkSize: 3,
};

function isBrowser() {
  return typeof window !== "undefined";
}

export function loadStats(): Stats {
  if (!isBrowser()) return { events: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { events: [] };
    const parsed = JSON.parse(raw) as Stats;
    return parsed?.events ? parsed : { events: [] };
  } catch {
    return { events: [] };
  }
}

export function saveStats(stats: Stats) {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

export function recordWords(words: number) {
  if (!isBrowser() || words <= 0) return;
  const stats = loadStats();
  // Coalesce events within last 5s
  const last = stats.events[stats.events.length - 1];
  const now = Date.now();
  if (last && now - last.at < 5_000) {
    last.words += words;
    last.at = now;
  } else {
    stats.events.push({ at: now, words });
  }
  // Trim to 90 days
  const cutoff = now - 90 * 24 * 3600_000;
  stats.events = stats.events.filter((e) => e.at >= cutoff);
  saveStats(stats);
}

export function loadSettings(): Settings {
  if (!isBrowser()) return defaultSettings;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(s: Settings) {
  if (!isBrowser()) return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export type DayKey = string; // YYYY-MM-DD

export function dayKey(d: Date): DayKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function wordsInRange(stats: Stats, fromMs: number, toMs: number) {
  return stats.events
    .filter((e) => e.at >= fromMs && e.at <= toMs)
    .reduce((sum, e) => sum + e.words, 0);
}

export function wordsLastHour(stats: Stats) {
  const now = Date.now();
  return wordsInRange(stats, now - 3600_000, now);
}

export function wordsToday(stats: Stats) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return wordsInRange(stats, start.getTime(), Date.now());
}

export function pagesFromWords(words: number) {
  return words / WORDS_PER_PAGE;
}

export function dailyTotals(stats: Stats): Record<DayKey, number> {
  const map: Record<DayKey, number> = {};
  for (const e of stats.events) {
    const key = dayKey(new Date(e.at));
    map[key] = (map[key] ?? 0) + e.words;
  }
  return map;
}
