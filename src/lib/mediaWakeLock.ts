// Media Session + hidden looping <video> wake-lock fallback.
// Mirrors YouTube's approach: an active <video> tag combined with
// navigator.mediaSession metadata signals the OS that media is playing,
// which prevents Android/iOS from dimming or sleeping the screen even
// when the Screen Wake Lock API is unavailable or denied (e.g. Opera).

// ~1 kB silent black MP4 (H.264) — https://gist.github.com/dmlap/5643609
const TINY_MP4 =
  "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAr9tZGF0AAACoAYF//+c3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDEyNSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMTIgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz02IGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yNCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA9liIQAV/0TAAYdeBTXzg8AAALvbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAACoAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAhl0cmFrAAAAXHRraGQAAAAPAAAAAAAAAAAAAAABAAAAAAAAACoAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAgAAAAIAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAqAAAAAAABAAAAAAGRbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAAgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABPG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPxzdGJsAAAAmHN0c2QAAAAAAAAAAQAAAIhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAgACABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMmF2Y0MBZAAK/+EAGWdkAAqs2V+WXAWyAAADAAIAAAMAYB4kSywBAAZo6+PLIsAAAAAYc3R0cwAAAAAAAAABAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAACtwAAAAEAAAAUc3RjbwAAAAAAAAABAAAAMA==";

let videoEl: HTMLVideoElement | null = null;

function ensureVideo(): HTMLVideoElement {
  if (videoEl) return videoEl;
  const v = document.createElement("video");
  v.src = TINY_MP4;
  v.loop = true;
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.setAttribute("aria-hidden", "true");
  // Must be in the DOM and technically visible for the OS to treat it as
  // active media. Keep it 1x1 and effectively invisible without display:none.
  v.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:1px",
    "height:1px",
    "opacity:0.01",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");
  document.body.appendChild(v);
  videoEl = v;
  return v;
}

export async function startMediaWakeLock(meta?: {
  title?: string;
  artist?: string;
  album?: string;
}) {
  try {
    const v = ensureVideo();
    // play() must be called inside a user gesture on mobile.
    await v.play().catch(() => {});
  } catch { /* ignore */ }

  try {
    const ms = (navigator as any).mediaSession;
    if (ms) {
      ms.metadata = new (window as any).MediaMetadata({
        title: meta?.title ?? "Speed Reader",
        artist: meta?.artist ?? "Pace",
        album: meta?.album ?? "Reading session",
      });
      ms.playbackState = "playing";
    }
  } catch { /* ignore */ }
}

export function stopMediaWakeLock() {
  try {
    if (videoEl) {
      videoEl.pause();
      videoEl.currentTime = 0;
    }
  } catch { /* ignore */ }
  try {
    const ms = (navigator as any).mediaSession;
    if (ms) {
      ms.playbackState = "paused";
      ms.metadata = null;
    }
  } catch { /* ignore */ }
}
