import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { dailyTotals, dayKey, loadStats, pagesFromWords } from "@/lib/stats";

export function ProgressCalendar() {
  const [tick, setTick] = useState(0);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener("pace:stats-changed", onChange);
    return () => window.removeEventListener("pace:stats-changed", onChange);
  }, []);

  const totals = useMemo(() => dailyTotals(loadStats()), [tick, cursor]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dayKey(new Date());

  const maxWords = Math.max(1, ...Object.values(totals));

  // streak (consecutive days up to today)
  let streak = 0;
  const day = new Date();
  while ((totals[dayKey(day)] ?? 0) > 0) {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }

  const cells: Array<{ key: string; day: number; words: number; isToday: boolean } | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dk = dayKey(new Date(year, month, d));
    cells.push({
      key: dk,
      day: d,
      words: totals[dk] ?? 0,
      isToday: dk === todayKey,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = first.toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <section className="rounded-2xl border border-border bg-card/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold text-ink">{monthLabel}</h3>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Flame className="h-3.5 w-3.5 text-ember" /> {streak}-day streak
          </p>
        </div>
        <div className="flex gap-1">
          <NavBtn onClick={() => setCursor(new Date(year, month - 1, 1))} aria="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </NavBtn>
          <NavBtn onClick={() => setCursor(new Date(year, month + 1, 1))} aria="Next month">
            <ChevronRight className="h-4 w-4" />
          </NavBtn>
        </div>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) =>
          c ? (
            <CalendarCell
              key={c.key}
              day={c.day}
              words={c.words}
              max={maxWords}
              isToday={c.isToday}
            />
          ) : (
            <div key={`empty-${i}`} className="aspect-square" />
          ),
        )}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
        <span>less</span>
        {[0.08, 0.25, 0.5, 0.85].map((a) => (
          <span key={a} className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: `color-mix(in oklab, var(--ember) ${a * 100}%, transparent)` }} />
        ))}
        <span>more</span>
      </div>
    </section>
  );
}

function NavBtn({ children, onClick, aria }: { children: React.ReactNode; onClick: () => void; aria: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={aria}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
    >
      {children}
    </button>
  );
}

function CalendarCell({
  day, words, max, isToday,
}: { day: number; words: number; max: number; isToday: boolean }) {
  const pages = pagesFromWords(words);
  const intensity = words === 0 ? 0 : Math.max(0.1, Math.min(1, words / max));
  return (
    <div
      title={`${pages.toFixed(1)} pages`}
      className={`relative aspect-square rounded-md border text-[10px] transition-colors ${
        isToday ? "border-ember" : "border-transparent"
      }`}
      style={{
        backgroundColor:
          words === 0
            ? "color-mix(in oklab, var(--muted) 60%, transparent)"
            : `color-mix(in oklab, var(--ember) ${intensity * 85}%, transparent)`,
      }}
    >
      <span className={`absolute left-1 top-0.5 ${words / max > 0.4 ? "text-ember-foreground" : "text-muted-foreground"}`}>
        {day}
      </span>
      {words > 0 && (
        <span className={`absolute bottom-0.5 right-1 font-mono tabular-nums ${
          words / max > 0.4 ? "text-ember-foreground" : "text-ink/80"
        }`}>
          {pages < 10 ? pages.toFixed(1) : Math.round(pages)}
        </span>
      )}
    </div>
  );
}
