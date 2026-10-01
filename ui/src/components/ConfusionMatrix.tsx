import { useState } from "react";
import { count } from "../lib/format";

export type Confusion = {
  labels: string[];
  matrix: (number | null)[][];
  rows?: string;
  columns?: string;
};

export default function ConfusionMatrix({ data }: { data: Confusion }) {
  const [normalize, setNormalize] = useState(false);
  const rowSums = data.matrix.map((row) => row.reduce<number>((a, v) => a + (v ?? 0), 0));
  const value = (v: number | null, i: number) => (v === null ? null : normalize ? (rowSums[i] ? v / rowSums[i] : 0) : v);
  const all = data.matrix.flatMap((row, i) => row.map((v) => value(v, i))).filter((v): v is number => v !== null);
  const max = Math.max(...all, 1e-9);
  const show = (v: number) => (normalize ? `${(v * 100).toFixed(1)} %` : count(v));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span className="faint" style={{ fontSize: 12.5 }}>
          rows: {data.rows ?? "ground truth"} · columns: {data.columns ?? "prediction"}
        </span>
        <div className="segmented">
          <button className={!normalize ? "on" : ""} onClick={() => setNormalize(false)}>Counts</button>
          <button className={normalize ? "on" : ""} onClick={() => setNormalize(true)}>Row %</button>
        </div>
      </div>
      <table className="cm">
        <thead>
          <tr>
            <th />
            {data.labels.map((l) => <th key={l} className="mono">{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.matrix.map((row, i) => (
            <tr key={data.labels[i]}>
              <th className="mono">{data.labels[i]}</th>
              {row.map((raw, j) => {
                const v = value(raw, i);
                if (v === null) return <td key={j} className="cm-none" title="not measured">–</td>;
                const t = v / max;
                return (
                  <td key={j} title={`${data.labels[i]} → ${data.labels[j]}: ${show(v)}`}
                    style={{
                      background: `color-mix(in srgb, var(--series-1) ${Math.round(8 + t * 82)}%, var(--surface))`,
                      color: t > 0.5 ? "#ffffff" : "var(--text)",
                    }}>
                    <span className="mono">{show(v)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
