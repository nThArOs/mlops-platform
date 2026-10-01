import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gauge, PackageOpen } from "lucide-react";
import { jobs, type ModelSummary, type ModelVersion } from "../api";
import { limitTone } from "../lib/health";
import { useFetch } from "../lib/useFetch";
import InfoTip, { Help } from "./InfoTip";
import { Badge, Field, Modal, Note } from "./ui";

const LIMITS: Record<string, [string, "max" | "min"]> = {
  latency_p50_ms: ["latency_ms.p50", "max"],
  latency_p95_ms: ["latency_ms.p95", "max"],
  latency_p99_ms: ["latency_ms.p99", "max"],
  end_to_end_p95_ms: ["end_to_end_ms.p95", "max"],
  cold_start_ms: ["cold_start_ms", "max"],
  ram_mb: ["ram_peak_mb", "max"],
  model_mb: ["model_mb", "max"],
  fps: ["fps", "min"],
};

type Bench = Record<string, number | boolean | string>;
const num = (b: Bench, k: string) => (typeof b[k] === "number" ? (b[k] as number) : undefined);
const fmt = (v?: number, digits = 0) => (v === undefined ? "–" : v.toFixed(digits));

// Class of a measured cell from the limit set on it for this profile, if any.
function cellTone(bench: Bench, key: string, limits?: Record<string, number>): string {
  const entry = Object.entries(limits ?? {}).find(([name]) => (LIMITS[name]?.[0] ?? name) === key);
  const v = num(bench, key);
  if (!entry || v === undefined) return "";
  return limitTone(v, entry[1], LIMITS[entry[0]]?.[1] ?? "max");
}

function violations(bench: Bench, limits?: Record<string, number>): string[] {
  if (!limits) return [];
  return Object.entries(limits).flatMap(([name, limit]) => {
    const [key, kind] = LIMITS[name] ?? [name, "max"];
    const v = num(bench, key);
    if (v === undefined) return [`${key} missing`];
    return (kind === "max" ? v > limit : v < limit) ? [`${key} ${fmt(v, 1)} ${kind === "max" ? ">" : "<"} ${limit}`] : [];
  });
}

function BenchmarkDialog({ meta, versions, onClose }: { meta: ModelSummary; versions: ModelVersion[]; onClose: () => void }) {
  const navigate = useNavigate();
  const options = useFetch(() => jobs.options(meta.project), [meta.project]);
  const [version, setVersion] = useState(String(meta.production ?? versions[versions.length - 1]?.version ?? ""));
  const [profile, setProfile] = useState(Object.keys(meta.constraints)[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!profile && options.data) setProfile(options.data.default_profile); }, [options.data, profile]);

  async function submit() {
    try {
      const job = await jobs.create({ project: meta.project, slot: meta.slot, entrypoint: "benchmark", model: `${meta.name}@v${version}`, profile, datasets: [] });
      navigate(`/runs/${job.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal open onClose={onClose} title="Benchmark a version" subtitle="Runs the project benchmark under the CPU and memory limits of a hardware profile."
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit}>Queue benchmark</button></>}>
      <div className="form-grid">
        <Field label="Version">
          <select className="select mono" value={version} onChange={(e) => setVersion(e.target.value)}>
            {[...versions].reverse().map((v) => <option key={v.version} value={v.version}>v{v.version}{v.variant ? ` · ${v.variant}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Hardware profile" hint="Docker-limited profiles approximate the target and are marked estimated.">
          <select className="select mono" value={profile} onChange={(e) => setProfile(e.target.value)}>
            {options.data?.profiles.map((p) => <option key={p.name} value={p.name}>{p.name}{p.cpus ? ` (${p.cpus} CPU, ${p.memory})` : ""}</option>)}
          </select>
        </Field>
      </div>
      {error && <Note kind="error">{error}</Note>}
    </Modal>
  );
}

function ExportDialog({ meta, versions, onClose }: { meta: ModelSummary; versions: ModelVersion[]; onClose: () => void }) {
  const navigate = useNavigate();
  const exportable = versions.filter((v) => !v.parent);
  const [version, setVersion] = useState(String(meta.production ?? exportable[exportable.length - 1]?.version ?? ""));
  const [format, setFormat] = useState("onnx-int8");
  const [evaluate, setEvaluate] = useState(true);
  const [bench, setBench] = useState<string[]>(Object.keys(meta.constraints));
  const [error, setError] = useState<string | null>(null);
  const options = useFetch(() => jobs.options(meta.project), [meta.project]);
  const prod = versions.find((v) => v.version === meta.production);

  async function submit() {
    const source = versions.find((v) => String(v.version) === version);
    const suffix = format === "onnx" ? "onnx" : "int8";
    try {
      const job = await jobs.create({
        project: meta.project, slot: meta.slot, entrypoint: "export", model: meta.name + "@v" + version, datasets: [],
        values: { format }, variant: (source?.variant ?? "v" + version) + "-" + suffix,
        auto_evaluate: evaluate, eval_datasets: Object.keys(prod?.evaluations ?? {}), benchmark_profiles: bench,
      });
      navigate("/runs/" + job.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (options.data && !options.data.entrypoints.export) {
    return (
      <Modal open onClose={onClose} title="Export a version" footer={<button className="btn" onClick={onClose}>Close</button>}>
        <Note>This project declares no export entrypoint.</Note>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title="Export a version"
      subtitle="The export becomes a new version linked to its source, so it can be evaluated, benchmarked and promoted like any other."
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit}>Queue export</button></>}>
      <div className="form-grid">
        <Field label="Source version">
          <select className="select mono" value={version} onChange={(e) => setVersion(e.target.value)}>
            {[...exportable].reverse().map((v) => <option key={v.version} value={v.version}>v{v.version}{v.variant ? " · " + v.variant : ""}</option>)}
          </select>
        </Field>
        <Field label="Format" hint="INT8 is calibrated on training frames; check its accuracy before promoting it.">
          <select className="select mono" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="onnx">ONNX, float32</option>
            <option value="onnx-int8">ONNX, INT8 quantized</option>
          </select>
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={evaluate} onChange={(e) => setEvaluate(e.target.checked)} />
        Evaluate on the datasets production was evaluated on
      </label>
      <ProfilePicker profiles={(options.data?.profiles ?? []).map((p) => ({ ...p, limits: meta.constraints[p.name] }))}
        picked={bench} onChange={setBench} />
      {error && <Note kind="error">{error}</Note>}
    </Modal>
  );
}

export const BENCHMARK_HELP = (
  <>
    <span>Runs the project benchmark inside the container, with the CPU and memory limits of each profile, on a recorded video.</span>
    <span>Measures latency per frame (p50, p95, p99) for the model alone and for the whole pipeline (decode, preprocessing, inference), frames per second, peak memory, model size, parameters and GFLOPs.</span>
    <span>Results on Docker-limited profiles are estimates of the target hardware. A version needs a benchmark on every profile that has constraints before it can be promoted.</span>
  </>
);

export type ProfileInfo = { name: string; cpus?: number; memory?: string; limits?: Record<string, number> };

function memory(m?: string): string {
  const v = m?.match(/^(\d+(?:\.\d+)?)\s*([gmk])b?$/i);
  return v ? `${v[1]} ${v[2].toUpperCase()}B` : m ?? "";
}

export function ProfilePicker({ profiles, picked, onChange }: {
  profiles: ProfileInfo[];
  picked: string[];
  onChange: (p: string[]) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">Benchmark on<Help title="Benchmark">{BENCHMARK_HELP}</Help></span>
      <div className="profiles">
        {profiles.map((p) => (
          <label key={p.name} className="profile-row">
            <input type="checkbox" checked={picked.includes(p.name)}
              onChange={(e) => onChange(e.target.checked ? [...picked, p.name] : picked.filter((x) => x !== p.name))} />
            <span className="mono">{p.name}</span>
            <span className="faint mono">{p.cpus ? `${p.cpus} CPU · ${memory(p.memory)}` : "whole machine"}</span>
            <span>
              {p.limits && Object.keys(p.limits).length > 0 && (
                <span className="limits">
                  <Badge>limits</Badge>
                  <Help title={`Limits on ${p.name}`}>
                    {Object.entries(p.limits).map(([k, v]) => <span key={k} className="mono">{k} ≤ {v}</span>)}
                    <span className="faint">A version that exceeds them can't be promoted.</span>
                  </Help>
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

type Point = { label: string; x: number; y: number; ok: boolean; v: ModelVersion; b: Bench; bad: string[]; f1?: number };

function Scatter({ points, primary, onSelect }: { points: Point[]; primary: string; onSelect?: (version: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [width, setWidth] = useState(520);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, e.contentRect.width)));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const H = 200, P = { l: 44, r: 16, t: 10, b: 28 };
  const xMax = Math.max(...points.map((p) => p.x)) * 1.15 || 1;
  const yMax = Math.max(...points.map((p) => p.y)) * 1.15 || 1;
  const sx = (x: number) => P.l + (x / xMax) * (width - P.l - P.r);
  const sy = (y: number) => P.t + (1 - y / yMax) * (H - P.t - P.b);
  return (
    <div ref={ref} className="chart">
      <div className="chart-head"><span className="chart-title">{primary.replace(/^mean\./, "")} against latency p95, better is up and left</span></div>
      <svg width={width} height={H} role="img" aria-label="Accuracy against latency">
        <line x1={P.l} x2={width - P.r} y1={H - P.b} y2={H - P.b} stroke="var(--grid)" />
        <line x1={P.l} x2={P.l} y1={P.t} y2={H - P.b} stroke="var(--grid)" />
        <text className="tick" x={P.l} y={H - 8}>0 ms</text>
        <text className="tick" x={width - P.r} y={H - 8} textAnchor="end">{xMax.toFixed(0)} ms</text>
        <text className="tick" x={P.l - 6} y={P.t + 8} textAnchor="end">{yMax.toFixed(0)}</text>
        {points.map((p) => (
          <g key={p.label} style={{ cursor: onSelect ? "pointer" : "default" }}
            onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onClick={() => onSelect?.(p.v.version)}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={14} fill="transparent" />
            <circle cx={sx(p.x)} cy={sy(p.y)} r={hover === p ? 7 : 5} fill={p.ok ? "var(--series-1)" : "var(--series-2)"} stroke="var(--bg)" strokeWidth={2} />
            <text className="end-label" x={sx(p.x) + 9} y={sy(p.y) + 4}>{p.label}</text>
          </g>
        ))}
      </svg>
      {hover && (
        <div className="chart-tip scatter-tip" style={{ left: Math.min(sx(hover.x) + 14, width - 230), top: Math.max(sy(hover.y) - 20, 0) }}>
          <div className="row"><span className="mono" style={{ fontWeight: 600 }}>{hover.label}</span>
            {hover.v.variant && <span className="mono faint">{hover.v.variant}</span>}
            <span className="faint">{hover.v.status}</span></div>
          {hover.v.parent && <div className="faint">exported from {hover.v.parent}</div>}
          <div className="tip-grid mono">
            <span className="faint">{primary.replace(/^mean\./, "")}</span><span>{hover.y.toFixed(2)}</span>
            {hover.f1 !== undefined && <><span className="faint">F1</span><span>{hover.f1.toFixed(2)}</span></>}
            <span className="faint">latency p95</span><span>{hover.x.toFixed(0)} ms</span>
            {num(hover.b, "fps") !== undefined && <><span className="faint">fps</span><span>{fmt(num(hover.b, "fps"), 2)}</span></>}
            {num(hover.b, "ram_peak_mb") !== undefined && <><span className="faint">RAM peak</span><span>{fmt(num(hover.b, "ram_peak_mb"))} MB</span></>}
            {num(hover.b, "model_mb") !== undefined && <><span className="faint">model</span><span>{fmt(num(hover.b, "model_mb"), 1)} MB</span></>}
          </div>
          <div className={hover.ok ? "faint" : ""} style={hover.ok ? undefined : { color: "var(--danger)" }}>
            {hover.ok ? "within constraints" : hover.bad.join(", ")}</div>
          {onSelect && <div className="faint">click to open its details</div>}
        </div>
      )}
      <div className="chart-legend" style={{ marginTop: 4 }}>
        <span><span className="key" style={{ background: "var(--series-1)" }} />within constraints</span>
        <span><span className="key" style={{ background: "var(--series-2)" }} />outside constraints</span>
      </div>
    </div>
  );
}

export default function Benchmarks({ meta, versions, dataset, onSelect }: {
  meta: ModelSummary;
  versions: ModelVersion[];
  dataset: string | null;
  onSelect?: (version: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const rows = versions.flatMap((v) => Object.entries(v.benchmarks ?? {}).map(([profile, b]) => ({ v, profile, b })));
  const profiles = [...new Set(rows.map((r) => r.profile))];
  const [profile, setProfile] = useState<string | null>(null);
  const shown = profile ?? (Object.keys(meta.constraints).find((p) => profiles.includes(p)) ?? profiles[0] ?? null);
  const points = rows.filter((r) => r.profile === shown && dataset && r.v.evaluations[dataset]?.[meta.primary] !== undefined && num(r.b, "latency_ms.p95") !== undefined)
    .map((r) => {
      const bad = violations(r.b, meta.constraints[r.profile]);
      return { label: `v${r.v.version}`, x: num(r.b, "latency_ms.p95")!, y: r.v.evaluations[dataset!][meta.primary], ok: bad.length === 0, v: r.v, b: r.b, bad,
        f1: r.v.evaluations[dataset!]["mean.F1"] };
    });

  return (
    <div className="section">
      <div className="section-head">
        <h2 className="section-title">Edge benchmarks<InfoTip metric="latency" /></h2>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="btn small" onClick={() => setExporting(true)}><PackageOpen size={13} /> Export</button>
          <button className="btn small" onClick={() => setOpen(true)}><Gauge size={13} /> Benchmark</button>
        </span>
      </div>
      {Object.keys(meta.constraints).length > 0 && (
        <p className="muted" style={{ marginTop: 0 }}>
          Constraints: {Object.entries(meta.constraints).map(([p, l]) => (
            <span key={p} style={{ marginRight: 14 }}><span className="mono">{p}</span> {Object.entries(l).map(([k, v]) => `${k} ${v}`).join(", ")}</span>
          ))}
        </p>
      )}
      {rows.length === 0 ? <p className="muted">No benchmark yet. Benchmark a version on a hardware profile to see its latency, memory and whether it fits.</p> : (
        <>
          <table className="rows">
            <thead>
              <tr>
                <th>version</th><th>profile</th><th className="num">p50 ms</th><th className="num">p95 ms</th><th className="num">p99 ms</th>
                <th className="num">frame p95 ms</th><th className="num">fps</th><th className="num">RAM MB</th><th className="num">model MB</th>
                <th className="num">GFLOPs</th><th>fits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ v, profile: p, b }) => {
                const bad = violations(b, meta.constraints[p]);
                return (
                  <tr key={`${v.version}-${p}`}>
                    <td className="mono">v{v.version}{v.variant && <span className="faint"> {v.variant}</span>}</td>
                    <td><span className="mono">{p}</span>{!b._measured && <span className="faint" style={{ marginLeft: 6 }}>estimated</span>}</td>
                    <td className={`num mono ${cellTone(b, "latency_ms.p50", meta.constraints[p])}`}>{fmt(num(b, "latency_ms.p50"))}</td>
                    <td className={`num mono ${cellTone(b, "latency_ms.p95", meta.constraints[p])}`}>{fmt(num(b, "latency_ms.p95"))}</td>
                    <td className={`num mono ${cellTone(b, "latency_ms.p99", meta.constraints[p])}`}>{fmt(num(b, "latency_ms.p99"))}</td>
                    <td className={`num mono ${cellTone(b, "end_to_end_ms.p95", meta.constraints[p])}`}>{fmt(num(b, "end_to_end_ms.p95"))}</td>
                    <td className={`num mono ${cellTone(b, "fps", meta.constraints[p])}`}>{fmt(num(b, "fps"), 2)}</td>
                    <td className={`num mono ${cellTone(b, "ram_peak_mb", meta.constraints[p])}`}>{fmt(num(b, "ram_peak_mb"))}</td>
                    <td className={`num mono ${cellTone(b, "model_mb", meta.constraints[p])}`}>{fmt(num(b, "model_mb"), 1)}</td>
                    <td className="num mono">{fmt(num(b, "gflops"), 1)}</td>
                    <td>{!meta.constraints[p] ? <span className="faint">no limits</span> : bad.length === 0
                      ? <Badge tone="success">fits</Badge> : <span title={bad.join("\n")}><Badge tone="danger">{bad.length} over</Badge></span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {points.length > 0 && (
            <div style={{ marginTop: 24 }}>
              {profiles.length > 1 && (
                <div className="segmented" style={{ marginBottom: 10 }}>
                  {profiles.map((p) => <button key={p} className={p === shown ? "on" : ""} onClick={() => setProfile(p)}>{p}</button>)}
                </div>
              )}
              <Scatter points={points} primary={meta.primary} onSelect={onSelect} />
            </div>
          )}
        </>
      )}
      {open && <BenchmarkDialog meta={meta} versions={versions} onClose={() => setOpen(false)} />}
      {exporting && <ExportDialog meta={meta} versions={versions} onClose={() => setExporting(false)} />}
    </div>
  );
}
