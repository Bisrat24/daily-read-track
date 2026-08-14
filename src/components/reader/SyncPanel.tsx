import { useEffect, useState } from "react";
import { Cloud, CloudUpload, CloudDownload, LogOut, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { fetchRemoteMeta, pullProgress, pushProgress } from "@/lib/sync";

export function SyncPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "in" | "up" | "google" | "push" | "pull">(null);
  const [remote, setRemote] = useState<{ device: string | null; updated_at: string } | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    void supabase.auth.getSession().then(({ data: d }) => setSession(d.session));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setRemote(null); return; }
    void fetchRemoteMeta().then((m) => setRemote(m as typeof remote));
  }, [session]);

  async function signIn(mode: "in" | "up") {
    setBusy(mode);
    const fn =
      mode === "in"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });
    const { error } = await fn;
    setBusy(null);
    if (error) return toast.error(error.message);
    setPassword("");
    toast.success(mode === "in" ? "Signed in." : "Account created — check your email if confirmation is required.");
  }

  async function google() {
    setBusy("google");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) { setBusy(null); return toast.error("Google sign-in failed."); }
    if (result.redirected) return;
    setBusy(null);
  }

  async function backUp() {
    if (!session) return;
    setBusy("push");
    try {
      await pushProgress(session.user.id);
      setRemote(await fetchRemoteMeta() as typeof remote);
      toast.success("Progress backed up to your account.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed.");
    }
    setBusy(null);
  }

  async function restore() {
    setBusy("pull");
    try {
      const res = await pullProgress();
      toast.success(res ? "Progress merged from your account." : "No cloud backup found yet.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed.");
    }
    setBusy(null);
  }

  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Cloud className="h-4 w-4 text-ember" />
        <span className="flex-1 font-display text-base font-semibold text-ink">
          Sync progress
        </span>
        <span className="text-xs text-muted-foreground">
          {session ? session.user.email ?? "signed in" : "off"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {!session ? (
            <>
              <p className="text-xs text-muted-foreground">
                Sign in to keep your reading calendar and book positions on your account, so you
                can carry them to another device.
              </p>
              <Button
                onClick={() => void google()}
                disabled={busy !== null}
                variant="outline"
                className="w-full"
              >
                {busy === "google" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Continue with Google
              </Button>
              <div className="space-y-2">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => void signIn("in")}
                    disabled={busy !== null || !email || !password}
                    className="flex-1 bg-ember text-ember-foreground hover:bg-ember/90"
                  >
                    {busy === "in" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Sign in
                  </Button>
                  <Button
                    onClick={() => void signIn("up")}
                    disabled={busy !== null || !email || !password}
                    variant="outline"
                    className="flex-1"
                  >
                    {busy === "up" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Create account
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {remote
                  ? `Last backup ${new Date(remote.updated_at).toLocaleString()}${remote.device ? ` from ${remote.device}` : ""}.`
                  : "No backup saved yet."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void backUp()}
                  disabled={busy !== null}
                  className="gap-1.5 bg-ember text-ember-foreground hover:bg-ember/90"
                >
                  {busy === "push" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                  Back up now
                </Button>
                <Button onClick={() => void restore()} disabled={busy !== null} variant="outline" className="gap-1.5">
                  {busy === "pull" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                  Restore
                </Button>
                <Button
                  onClick={() => void supabase.auth.signOut()}
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Book files stay on this device — sync carries your calendar, settings, and the
                position of books with matching titles.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
