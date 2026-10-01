import type { ModelSummary, ModelVersion } from "../api";
import { lookup } from "../lib/glossary";
import { compared } from "../lib/health";
import ConfusionMatrix from "./ConfusionMatrix";
import InfoTip from "./InfoTip";
import LineChart from "./LineChart";
import { Stat } from "./ui";

const HIDDEN = new Set(["operational.video_hours", "operational.predicted_tracks", "operational.detection_delay_s.mean"]);
const pct = (v: number) => `${v.toFixed(0)} %`;

function nice(key: string): string {
  const entry = lookup(key);
  if (entry) return entry.title;
  return key.replace(/^operational\./, "").replace(/[._]/g, " ");
}

function number(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
}

function SliceBars({ name, values, counts, edges }: {
  name: string;
  values: Record<string, number | null>;
  counts?: Record<string, number | null>;
  edges?: number[];
}) {
  const ranges: Record<string, string> = edges && edges.length === 2
    ? { small: `< ${edges[0]} px`, medium: `${edges[0]}–${edges[1]} px`, large: `> ${edges[1]} px` } : {};
  return (
    <div>
      <div className="chart-head"><span className="chart-title">{nice(name)}<InfoTip metric={name} /></span></div>
      <div className="slices">
        {Object.entries(values).map(([k, v]) => (
          <div key={k} className="slice-row">
            <span className="slice-label">{k}{ranges[k] && <span className="faint mono"> {ranges[k]}</span>}</span>
            <span className="slice-track">
              {v !== null && <span className="slice-bar" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />}
            </span>
            <span className="mono">{v === null ? "–" : `${v.toFixed(1)} %`}</span>
            {counts?.[k] != null && <span className="faint mono" style={{ fontSize: 12 }}>{counts[k]} objects</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VersionDetails({ version, dataset, meta, production }: {
  version: ModelVersion;
  dataset: string;
  meta: ModelSummary;
  production?: ModelVersion;
}) {
  const reference = production && production.version !== version.version ? production.evaluations[dataset] : undefined;
  const health = (k: string, v: number) => {
    const better = lookup(k)?.better;
    return reference?.[k] !== undefined && better ? compared(v, reference[k], production!.version, better) : undefined;
  };
  const metrics = version.evaluations[dataset] ?? {};
  const extras = version.extras?.[dataset] ?? {};
  const operational = Object.keys(metrics).filter((k) => k.startsWith("operational.") && !HIDDEN.has(k));
  const curves = Object.entries(extras.curves ?? {});
  const slices = extras.slices ?? {};
  const counts = slices.objects_by_size as Record<string, number | null> | undefined;
  const edges = Array.isArray(slices.size_edges_px) ? slices.size_edges_px : undefined;
  const bars = Object.entries(slices).filter(([k, v]) => !Array.isArray(v) && k !== "objects_by_size") as [string, Record<string, number | null>][];
  const cm = version.confusion?.[dataset];

  return (
    <>
      {operational.length > 0 && (
        <div className="stats" style={{ marginBottom: 24 }}>
          {operational.map((k) => (
            <Stat key={k} label={<>{nice(k)}<InfoTip metric={k} custom={meta.descriptions} /></>} value={number(metrics[k])}
              health={health(k, metrics[k])} />
          ))}
        </div>
      )}
      {(curves.length > 0 || bars.length > 0) && (
        <div className="charts" style={{ marginBottom: 28 }}>
          {curves.map(([name, c]) => (
            <LineChart key={name} title={name === "threshold" ? "Precision, recall and F1 by confidence threshold" : name}
              info={name === "threshold" ? "threshold_curve" : undefined} format={pct} xFormat={(x) => x.toFixed(2)}
              series={Object.keys(c).filter((s) => s !== "x").slice(0, 3).map((s, i) => ({
                name: s, color: `var(--series-${i + 1})`,
                // precision is undefined once no prediction passes the threshold
                points: c.x.map((x, j) => [x, c[s][j]] as [number, number])
                  .filter(([, y], j) => y !== null && !(s === "precision" && y === 0 && c.recall?.[j] === 0)),
              }))} />
          ))}
          {bars.map(([name, values]) => <SliceBars key={name} name={name} values={values} counts={counts} edges={edges} />)}
        </div>
      )}
      {cm && <ConfusionMatrix data={cm} />}
    </>
  );
}
