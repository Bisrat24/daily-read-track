// Robust screen-stay-awake manager.
//
// Layered defenses, most-preferred first:
//   1. navigator.wakeLock.request('screen') — the standard API.
//      Automatically re-requested on visibilitychange when we're "wanted".
//   2. Hidden looping <video> + navigator.mediaSession — YouTube-style hint
//      that active media is playing so the OS suppresses dim/sleep timers.
//   3. Micro-canvas rAF loop — a 1x1 canvas that repaints every frame while
//      active, forcing the browser to report continuous foreground work to
//      the OS. Cheap in CPU/GPU, but enough to defeat mobile idle heuristics
//      when both #1 and #2 are unavailable or dropped by battery-saver.
//
// The public surface is intentionally tiny: request() from a user gesture
// (Play button), release() when reading stops. Everything else is internal.

import { startMediaWakeLock, stopMediaWakeLock } from "./mediaWakeLock";

export type WakeStatus = {
  /** true when the reader has asked for the screen to stay awake. */
  wanted: boolean;
  /** true when at least one layer is holding the screen awake. */
  active: boolean;
  /** Whether the browser exposes navigator.wakeLock at all. */
  nativeSupported: boolean;
  /** Native Screen Wake Lock sentinel is currently held. */
  nativeHeld: boolean;
  /** Hidden <video> + mediaSession fallback is running. */
  mediaHint: boolean;
  /** Micro-canvas rAF fallback is running. */
  canvasLoop: boolean;
};

type StatusListener = (s: WakeStatus) => void;

let sentinel: any = null;
let wanted = false;
let mediaActive = false;
let listeners = new Set<StatusListener>();
let canvasRaf = 0;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let bootstrapped = false;
let meta: { title?: string; artist?: string } = {};

function snapshot(): WakeStatus {
  const nativeSupported =
    typeof navigator !== "undefined" && !!(navigator as any).wakeLock?.request;
  const nativeHeld = sentinel != null;
  const mediaHint = mediaActive;
  const canvasLoop = canvasRaf !== 0;
  return {
    wanted,
    active: wanted && (nativeHeld || mediaHint || canvasLoop),
    nativeSupported,
    nativeHeld,
    mediaHint,
    canvasLoop,
  };
}

function notify() {
  const s = snapshot();
  for (const fn of listeners) fn(s);
}


function ensureCanvas() {
  if (canvas) return;
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 2;
  c.setAttribute("aria-hidden", "true");
  c.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1";
  document.body.appendChild(c);
  canvas = c;
  ctx = c.getContext("2d");
}

function startCanvasLoop() {
  if (canvasRaf) return;
  ensureCanvas();
  let i = 0;
  const tick = () => {
    // Cheap paint — alternates a single pixel each frame to keep the
    // compositor active without wasting real work.
    if (ctx) {
      i = (i + 1) & 0xff;
      ctx.fillStyle = `rgba(${i},${i},${i},0.01)`;
      ctx.fillRect(0, 0, 2, 2);
    }
    canvasRaf = requestAnimationFrame(tick);
  };
  canvasRaf = requestAnimationFrame(tick);
}

function stopCanvasLoop() {
  if (canvasRaf) cancelAnimationFrame(canvasRaf);
  canvasRaf = 0;
}

async function tryNativeLock(): Promise<boolean> {
  const wl: any = (navigator as any).wakeLock;
  if (!wl?.request) return false;
  if (sentinel) return true;
  try {
    const lock = await wl.request("screen");
    sentinel = lock;
    lock.addEventListener?.("release", () => {
      sentinel = null;
      // If the OS/battery-saver dropped the lock while we still want it,
      // spin up the canvas fallback and try to re-acquire on next visibility.
      if (wanted) startCanvasLoop();
      notify();
    });
    // Native lock is holding — canvas fallback is redundant.
    stopCanvasLoop();
    return true;
  } catch {
    return false;
  }
}

function bootstrapListeners() {
  if (bootstrapped || typeof document === "undefined") return;
  bootstrapped = true;
  document.addEventListener("visibilitychange", () => {
    if (!wanted) return;
    if (document.visibilityState === "visible") {
      // Re-arm on return; the native lock is auto-released while hidden.
      void tryNativeLock().then((ok) => {
        if (!ok) startCanvasLoop();
        notify();
      });
    }
  });
  // Some browsers only fire wake-lock release without visibilitychange.
  window.addEventListener("focus", () => {
    if (wanted && !sentinel) {
      void tryNativeLock().then((ok) => {
        if (!ok) startCanvasLoop();
        notify();
      });
    }
  });
}

/** Request screen-awake. MUST be called from a user gesture on mobile. */
export async function requestWake(m?: { title?: string; artist?: string }) {
  if (typeof window === "undefined") return;
  bootstrapListeners();
  wanted = true;
  meta = m ?? meta;
  // #2: media hint (safe to call from gesture; ignored if unsupported).
  startMediaWakeLock({ title: meta.title, artist: meta.artist });
  // #1: native lock.
  const nativeOk = await tryNativeLock();
  // #3: canvas fallback whenever the native lock isn't holding.
  if (!nativeOk) startCanvasLoop();
  notify();
}

export function releaseWake() {
  wanted = false;
  stopMediaWakeLock();
  stopCanvasLoop();
  try {
    sentinel?.release?.();
  } catch {
    /* ignore */
  }
  sentinel = null;
  notify();
}

export function onWakeStatus(fn: StatusListener) {
  listeners.add(fn);
  fn(wanted && (sentinel != null || canvasRaf !== 0));
  return () => listeners.delete(fn);
}
