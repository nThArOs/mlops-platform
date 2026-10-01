import type { JobProgress } from "../api";

export function duration(seconds?: number | null): string {
  if (seconds == null) return "–";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

export function clock(epochSeconds?: number | null): string {
  if (epochSeconds == null) return "–";
  const d = new Date(epochSeconds * 1000);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString("en-GB", sameDay ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ProgressBar({ progress, compact }: { progress?: JobProgress | null; compact?: boolean }) {
  const f = progress?.fraction;
  const pct = f == null ? null : Math.round(f * 1000) / 10;
  const end = progress?.remaining_s != null ? Date.now() / 1000 + progress.remaining_s : null;
  return (
    <div className={`progress ${compact ? "compact" : ""}`}>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={pct ?? undefined} aria-label={progress?.label ?? "running"}>
        {pct == null ? <span className="progress-fill indeterminate" /> : <span className="progress-fill" style={{ width: `${pct}%` }} />}
      </div>
      <div className="progress-meta">
        <span>{progress?.label ?? "running"}{pct != null && <span className="mono"> · {pct.toFixed(pct < 10 ? 1 : 0)} %</span>}</span>
        <span className="faint">
          {duration(progress?.elapsed_s)} elapsed
          {progress?.remaining_s != null && <> · about {duration(progress.remaining_s)} left, ends around {clock(end)}</>}
        </span>
      </div>
    </div>
  );
}
