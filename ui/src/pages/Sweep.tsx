import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, X } from "lucide-react";
import { jobs, models, sweeps, type ModelSummary } from "../api";
import DatasetPicker, { refsOf, type Picked } from "../components/DatasetPicker";
import { Help } from "../components/InfoTip";
import { statusBadge } from "./Runs";
import { Field, Loading, Modal, Note } from "../components/ui";
import { date } from "../lib/format";
import { useFetch } from "../lib/useFetch";

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  return Object.entries(obj).reduce<Record<string, unknown>>((out, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
    return out;
  }, {});
}

function parseValues(text: string, sample: unknown): unknown[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean)
    .map((s) => (typeof sample === "number" && !Number.isNaN(Number(s)) ? Number(s)
      : typeof sample === "boolean" ? s === "true" : s));
}

export function SweepDialog({ meta, onClose }: { meta: ModelSummary; onClose: () => void }) {
  const navigate = useNavigate();
  const options = useFetch(() => jobs.options(meta.project), [meta.project]);
  const registry = useFetch(() => models.get(meta.name), [meta.name]);
  const [entrypoint, setEntrypoint] = useState("evaluate");
  const [version, setVersion] = useState<number | null>(null);
  const [picked, setPicked] = useState<Picked>({});
  const [rows, setRows] = useState<{ param: string; values: string }[]>([{ param: "", values: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const o = options.data;
  const config = o?.entrypoints[entrypoint]?.config ?? null;
  const base = useFetch(() => (config ? jobs.config(meta.project, config) : Promise.resolve(null)), [meta.project, config]);
  const flat = useMemo(() => flatten(base.data?.values ?? {}), [base.data]);

  useEffect(() => {
    const v = registry.data;
    if (!v || version !== null) return;
    const chosen = v.production ?? v.versions[v.versions.length - 1]?.version ?? null;
    setVersion(chosen);
    const evals = Object.keys(v.versions.find((x) => x.version === chosen)?.evaluations ?? {});
    setPicked(Object.fromEntries(evals.map((r) => r.split("@v")).map(([n, x]) => [n, Number(x)])));
  }, [registry.data, version]);

  const grid = Object.fromEntries(rows.filter((r) => r.param && r.values.trim())
    .map((r) => [r.param, parseValues(r.values, flat[r.param])]));
  const count = Object.values(grid).reduce((n, v) => n * v.length, Object.keys(grid).length ? 1 : 0);

  async function submit() {
    if (!count) return setError("Choose at least one parameter and its values.");
    if (refsOf(picked).length === 0) return setError("Check at least one dataset.");
    setBusy(true);
    setError(null);
    try {
      const s = await sweeps.create({
        project: meta.project, slot: meta.slot, entrypoint, config, datasets: refsOf(picked), grid,
        profile: o?.default_profile, model: entrypoint === "train" ? undefined : `${meta.name}@v${version}`,
      });
      navigate(`/sweeps/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Sweep parameters"
      subtitle="One run per combination of the values below, queued like any other run."
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} aria-busy={busy}>Queue {count || ""} run{count === 1 ? "" : "s"}</button>
      </>}>
      {!o && <Loading />}
      {o && (
        <>
          <div className="form-grid">
            <Field label="What to sweep" help={<Help title="Sweep">
              <span>Evaluate reruns the evaluation of one version with other settings, for example the tracker or the confidence threshold: no training, so it is quick. These runs are not recorded as the version's evaluation.</span>
              <span>Train trains one new version per combination.</span>
            </Help>}>
              <select className="select" value={entrypoint} onChange={(e) => { setEntrypoint(e.target.value); setRows([{ param: "", values: "" }]); }}>
                {["evaluate", "train"].filter((e) => o.entrypoints[e]).map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </Field>
            {entrypoint !== "train" && (
              <Field label="Version">
                <select className="select mono" value={version ?? ""} onChange={(e) => setVersion(Number(e.target.value))}>
                  {(registry.data?.versions ?? []).map((v) => <option key={v.version} value={v.version}>v{v.version}{v.variant ? ` ${v.variant}` : ""}</option>)}
                </select>
              </Field>
            )}
          </div>
          {!config && <Note kind="error">The {entrypoint} entrypoint declares no config, so it has nothing to sweep.</Note>}
          {config && (
            <div className="field">
              <span className="field-label">Grid <span className="faint">· {config}</span></span>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select className="select mono" style={{ flex: 1 }} value={r.param}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { param: e.target.value, values: String(flat[e.target.value] ?? "") } : x)))}>
                    <option value="">parameter</option>
                    {Object.keys(flat).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <input className="input mono" style={{ flex: 1 }} placeholder="values, separated by commas" value={r.values}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} />
                  <button className="btn ghost small" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X size={13} /></button>
                </div>
              ))}
              <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setRows([...rows, { param: "", values: "" }])}>
                <Plus size={13} /> Parameter
              </button>
            </div>
          )}
          <DatasetPicker label={entrypoint === "train" ? "Train on" : "Evaluate on"} project={meta.project}
            declared={o.datasets} picked={picked} onChange={setPicked}
            help={<Help title="Datasets"><span>Defaults to the datasets the chosen version was evaluated on.</span></Help>} />
          {error && <Note kind="error">{error}</Note>}
        </>
      )}
    </Modal>
  );
}

const show = (v: unknown) => (typeof v === "number" ? String(v) : JSON.stringify(v));

export function SweepPage() {
  const { id = "" } = useParams();
  const sweep = useFetch(() => sweeps.get(id), [id]);
  const list = useFetch(models.list, []);
  const s = sweep.data;
  const meta = list.data?.find((m) => m.name === s?.model);
  const running = s?.points.some((p) => ["queued", "running", "cancelling"].includes(p.status));
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(sweep.reload, 5000);
    return () => window.clearInterval(t);
  }, [running, sweep.reload]);

  if (!s || !meta) return sweep.error ? <Note kind="error">{sweep.error}</Note> : <Loading />;
  const primary = meta.primary;
  const keys = [primary, ...meta.watch.filter((k) => k !== primary)].slice(0, 5);
  const sign = meta.higher_is_better ? -1 : 1;
  const rows = [...s.points].sort((a, b) => sign * ((a.metrics[primary] ?? -Infinity * sign) - (b.metrics[primary] ?? -Infinity * sign)));
  const best = rows.find((r) => r.metrics[primary] !== undefined);

  return (
    <>
      <Link to={`/models/${s.model}`} className="btn ghost small" style={{ marginLeft: -12, marginBottom: 12 }}><ArrowLeft size={14} /> {s.model}</Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">sweep {s.id}</div>
          <h1 className="title">{s.entrypoint === "train" ? "Training sweep" : `Evaluation sweep of ${s.spec.model?.split("@")[1] ?? ""}`}</h1>
          <div className="subtitle status-line">
            <span>{s.points.length} runs</span>
            <span className="mono">{s.spec.config}</span>
            <span>{(s.spec.datasets ?? []).join(", ")}</span>
            <span>{date(s.created_at)}</span>
          </div>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Sorted by {primary.replace(/^mean\./, "")}, best first. Evaluation sweeps don't change the version's recorded evaluation: copy the best values into the project's config to keep them.</p>
      <table className="table">
        <thead>
          <tr>
            <th>run</th>
            {s.params.map((p) => <th key={p} className="mono">{p}</th>)}
            <th>status</th>
            {keys.map((k) => <th key={k} className="num">{k.replace(/^mean\./, "")}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.job} style={{ fontWeight: r === best ? 600 : 400 }}>
              <td><Link className="mono" to={`/runs/${r.job}`}>#{r.job}</Link></td>
              {s.params.map((p) => <td key={p} className="mono">{show(r.point[p])}</td>)}
              <td>{statusBadge(r.status)}</td>
              {keys.map((k) => <td key={k} className="num mono">{r.metrics[k] === undefined ? "–" : r.metrics[k].toFixed(2)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
