import { useEffect, useRef, useState } from "react";

export type Series = { name: string; points: [number, number][]; color: string };

const PAD = { top: 8, right: 56, bottom: 22, left: 44 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const time = (t: number) => new Date(t * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export default function LineChart({ title, series, format, height = 150 }: {
  title: string;
  series: Series[];
  format: (v: number) => string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const filled = series.filter((s) => s.points.length > 0);
  const all = filled.flatMap((s) => s.points);
  const xs = [...new Set(all.map((p) => p[0]))].sort((a, b) => a - b);
  const x0 = xs[0] ?? 0;
  const x1 = xs[xs.length - 1] ?? 1;
  const yMax = niceMax(Math.max(0, ...all.map((p) => p[1])) * 1.1);

  const w = width - PAD.left - PAD.right;
  const h = height - PAD.top - PAD.bottom;
  const sx = (t: number) => PAD.left + (x1 === x0 ? w : ((t - x0) / (x1 - x0)) * w);
  const sy = (v: number) => PAD.top + h - (v / yMax) * h;

  const ends = filled.map((s) => sy(s.points[s.points.length - 1][1])).sort((a, b) => a - b);
  const endLabels = filled.length > 1 && ends.every((y, i) => i === 0 || y - ends[i - 1] >= 12);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const t = x0 + ((e.clientX - box.left) / box.width) * (x1 - x0);
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(xs[best] - t)) best = i; });
    setHover(xs[best] ?? null);
  }

  const legend = filled.length > 1 && (
    <div className="chart-legend">
      {filled.map((s) => <span key={s.name}><span className="key" style={{ background: s.color }} />{s.name}</span>)}
    </div>
  );

  return (
    <div className="chart" ref={ref}>
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        {legend}
      </div>
      {filled.length === 0 ? (
        <div className="chart-empty">No data in this range</div>
      ) : (
        <svg width={width} height={height} role="img" aria-label={title}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={PAD.left + w} y1={sy(yMax * f)} y2={sy(yMax * f)} stroke="var(--grid)" />
              <text className="tick" x={PAD.left - 8} y={sy(yMax * f) + 3.5} textAnchor="end">{format(yMax * f)}</text>
            </g>
          ))}
          <text className="tick" x={PAD.left} y={height - 4}>{time(x0)}</text>
          <text className="tick" x={PAD.left + w} y={height - 4} textAnchor="end">{time(x1)}</text>
          {filled.map((s) => {
            const d = s.points.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
            const last = s.points[s.points.length - 1];
            return (
              <g key={s.name}>
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={sx(last[0])} cy={sy(last[1])} r={4} fill={s.color} stroke="var(--bg)" strokeWidth={2} />
                {endLabels && (
                  <text className="end-label" x={sx(last[0]) + 8} y={sy(last[1]) + 4}>{s.name}</text>
                )}
              </g>
            );
          })}
          {hover !== null && (
            <line x1={sx(hover)} x2={sx(hover)} y1={PAD.top} y2={PAD.top + h} stroke="var(--border-strong)" />
          )}
          <rect x={PAD.left} y={PAD.top} width={w} height={h} fill="transparent"
            onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(sx(hover) + 12, width - 150) }}>
          <div className="faint mono">{time(hover)}</div>
          {filled.map((s) => {
            const p = s.points.find((q) => q[0] === hover);
            return (
              <div className="row" key={s.name}>
                <span className="key" style={{ background: s.color }} />
                {filled.length > 1 && <span className="muted">{s.name}</span>}
                <span className="mono">{p ? format(p[1]) : "–"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
