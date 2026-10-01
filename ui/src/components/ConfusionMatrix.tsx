import { useState } from "react";
import { count } from "../lib/format";
import InfoTip from "./InfoTip";

export type Confusion = {
  labels: string[];
  matrix: (number | null)[][];
  rows?: string;
  columns?: string;
};

function cellName(labels: string[], i: number, j: number): { tag: string; title: string; what: string } {
  const bg = labels.length - 1;
  const hasBg = labels[bg] === "background";
  const truth = labels[i];
  const pred = labels[j];
  if (hasBg && i === bg && j === bg) return { tag: "TN", title: "True negatives", what: "Background predicted as background. Not counted for detection: there is no finite number of empty boxes." };
  if (hasBg && i === bg) return { tag: "FP", title: "False positives", what: `False alarms: the model predicted ${pred} where nothing was annotated.` };
  if (hasBg && j === bg) return { tag: "FN", title: "False negatives", what: `Misses: a real ${truth} that the model didn't detect.` };
  if (i === j) return { tag: "TP", title: "True positives", what: `Correct detections: a real ${truth} predicted as ${pred}.` };
  return { tag: "Confusion", title: `${truth} seen as ${pred}`, what: `A real ${truth} that the model labeled ${pred}.` };
}

type Cell = [number, number];

function Derived({ data, onHover }: { data: Confusion; onHover: (cells: Cell[]) => void }) {
  const m = data.matrix.map((row) => row.map((v) => v ?? 0));
  const n = m.length;
  const bgIndex = data.labels[n - 1] === "background" ? n - 1 : -1;
  const classes = data.labels.map((_, i) => i).filter((i) => i !== bgIndex);
  const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
  const others = (i: number) => m.map((_, k) => k).filter((k) => k !== i);

  return (
    <div className="derived">
      {classes.map((i) => {
        const tp = m[i][i];
        const fpCells: Cell[] = others(i).map((r) => [r, i]);
        const fnCells: Cell[] = others(i).map((c) => [i, c]);
        const fp = fpCells.reduce((a, [r, c]) => a + m[r][c], 0);
        const fn = fnCells.reduce((a, [r, c]) => a + m[r][c], 0);
        const p = tp + fp ? tp / (tp + fp) : 0;
        const r = tp + fn ? tp / (tp + fn) : 0;
        const f1 = 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 0;
        const rows = [
          { name: "Precision", formula: "TP / (TP + FP)", filled: `${count(tp)} / (${count(tp)} + ${count(fp)})`, value: p, cells: [[i, i] as Cell, ...fpCells] },
          { name: "Recall", formula: "TP / (TP + FN)", filled: `${count(tp)} / (${count(tp)} + ${count(fn)})`, value: r, cells: [[i, i] as Cell, ...fnCells] },
          { name: "F1", formula: "2·TP / (2·TP + FP + FN)", filled: `2·${count(tp)} / (2·${count(tp)} + ${count(fp)} + ${count(fn)})`, value: f1, cells: [[i, i] as Cell, ...fpCells, ...fnCells] },
        ];
        return (
          <div key={i} className="derived-class">
            {classes.length > 1 && <div className="nav-label" style={{ padding: 0 }}>{data.labels[i]}</div>}
            {rows.map((row) => (
              <div key={row.name} className="derived-row" tabIndex={0}
                onMouseEnter={() => onHover(row.cells)} onMouseLeave={() => onHover([])}
                onFocus={() => onHover(row.cells)} onBlur={() => onHover([])}>
                <span className="derived-name">{row.name}<InfoTip metric={row.name.toLowerCase()} /></span>
                <span className="mono faint">{row.formula}</span>
                <span className="mono">= {row.filled}</span>
                <span className="mono derived-value">= {pct(row.value)}</span>
              </div>
            ))}
          </div>
        );
      })}
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>Hover a line to see which cells it uses.</p>
    </div>
  );
}

export default function ConfusionMatrix({ data }: { data: Confusion }) {
  const [normalize, setNormalize] = useState(false);
  const [lit, setLit] = useState<Cell[]>([]);
  const isLit = (i: number, j: number) => lit.some(([r, c]) => r === i && c === j);
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
      <div className="cm-layout">
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
                const name = cellName(data.labels, i, j);
                const tip = (
                  <span role="tooltip" className={`tip-panel ${j === row.length - 1 ? "right" : "left"}`}>
                    <span className="tip-title">{name.title}</span>
                    <span>{name.what}</span>
                    <span className="faint mono">{data.labels[i]} → {data.labels[j]}{v !== null ? `: ${show(v)}` : ""}</span>
                  </span>
                );
                if (v === null) {
                  return (
                    <td key={j} className={`cm-none tip ${isLit(i, j) ? "lit" : ""}`} tabIndex={0}>
                      <span className="cm-tag">{name.tag}</span>
                      <span className="mono">not measured</span>
                      {tip}
                    </td>
                  );
                }
                const t = v / max;
                return (
                  <td key={j} className={`tip ${isLit(i, j) ? "lit" : ""}`} tabIndex={0}
                    style={{
                      background: `color-mix(in srgb, var(--series-1) ${Math.round(8 + t * 82)}%, var(--surface))`,
                      color: t > 0.5 ? "#ffffff" : "var(--text)",
                    }}>
                    <span className="cm-tag">{name.tag}</span>
                    <span className="mono">{show(v)}</span>
                    {tip}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Derived data={data} onHover={setLit} />
      </div>
    </div>
  );
}
