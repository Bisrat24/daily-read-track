// Service-worker registration wrapper.
// Refuses to register inside the Lovable editor preview, iframes, dev mode,
// or when ?sw=off is set; also unregisters any stale workers in those cases.

export async function registerPWA() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const url = new URL(window.location.href);
  const host = window.location.hostname;
  const inIframe = window.self !== window.top;
  const isPreviewHost =
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev");
  const refused =
    !import.meta.env.PROD || inIframe || isPreviewHost || url.searchParams.get("sw") === "off";

  if (refused) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs
          .filter((r) => r.active?.scriptURL.endsWith("/sw.js"))
          .map((r) => r.unregister()),
      );
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    console.warn("[pace] service worker registration failed", err);
  }
}
