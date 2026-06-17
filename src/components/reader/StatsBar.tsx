import { useEffect, useState } from "react";
import { Clock, BookOpen } from "lucide-react";
import { loadStats, pagesFromWords, wordsLastHour, wordsToday } from "@/lib/stats";

export function StatsBar() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener("pace:stats-changed", onChange);
    const id = window.setInterval(onChange, 30_000);
    return () => {
      window.removeEventListener("pace:stats-changed", onChange);
      window.clearInterval(id);
    };
  }, []);

  const stats = loadStats();
  const hourWords = wordsLastHour(stats);
  const todayWords = wordsToday(stats);
  const hourPages = pagesFromWords(hourWords);
  const todayPages = pagesFromWords(todayWords);

  return (
    <div className="grid grid-cols-2 gap-3" data-tick={tick}>
      <Stat
        icon={<Clock className="h-4 w-4" />}
        label="Last hour"
        primary={`${hourPages.toFixed(1)} pages`}
        secondary={`${hourWords.toLocaleString()} words`}
      />
      <Stat
        icon={<BookOpen className="h-4 w-4" />}
        label="Today"
        primary={`${todayPages.toFixed(1)} pages`}
        secondary={`${todayWords.toLocaleString()} words`}
      />
    </div>
  );
}

function Stat({
  icon, label, primary, secondary,
}: { icon: React.ReactNode; label: string; primary: string; secondary: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card/70 p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1.5 font-display text-2xl font-semibold text-ink">
        {primary}
      </div>
      <div className="text-xs text-muted-foreground">{secondary}</div>
    </div>
  );
}
