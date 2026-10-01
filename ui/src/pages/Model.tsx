import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Play, RotateCcw } from "lucide-react";
import { models, type ModelEvent, type ModelSummary, type PromotionCheck } from "../api";
import VersionDetails from "../components/VersionDetails";
import InfoTip from "../components/InfoTip";
import TrainDialog from "../components/TrainDialog";
import { Badge, Field, Loading, Modal, Note } from "../components/ui";
import { date } from "../lib/format";
import { useFetch } from "../lib/useFetch";

const metric = (v: number | undefined) => (v === undefined ? "–" : Math.abs(v) >= 100 ? v.toFixed(1) : v.toPrecision(4));

function statusBadge(status: string) {
  if (status === "production") return <Badge tone="success" dot>production</Badge>;
  if (status === "candidate") return <Badge tone="warning">candidate</Badge>;
  return <Badge>{status || "registered"}</Badge>;
}

export function Checks({ result }: { result: PromotionCheck }) {
  if (!result.checks.length) return null;
  return (
    <div className="checks">
      {result.checks.map((c) => (
        <div key={c.metric} className={`check-row ${c.ok ? "ok" : "ko"}`}>
          <span className="check-mark" aria-label={c.ok ? "passed" : "failed"}>{c.ok ? "✓" : "✕"}</span>
          <span className="mono">{c.metric}<InfoTip metric={c.metric} /></span>
          <span className="mono">{c.new === null ? "–" : metric(c.new)} <span className="faint">vs</span> {c.current === null ? "–" : metric(c.current)}</span>
          <span className="faint">{c.rule}</span>
        </div>
      ))}
    </div>
  );
}

export function PromoteDialog({ project, version, dataset, onClose, onDone }: {
  project: string;
  version: number;
  dataset: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const check = useFetch(() => models.check(project, version, dataset ?? undefined), [project, version, dataset]);
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = check.data?.allowed ?? false;

  async function submit() {
    if (!allowed && !force) return setError("This version can't be promoted without forcing it.");
    if (!allowed && !reason.trim()) return setError("Enter a reason, it's kept in the history.");
    setBusy(true);
    setError(null);
    try {
      const r = await models.promote(project, {
        version, dataset: dataset ?? undefined, force: !allowed, reason: reason.trim() || undefined,
      });
      onDone(`v${version} is in production${r.deployment ? `, service redeployed` : ""}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Promote v${version}`}
      subtitle={dataset ? `Compared on ${dataset}` : "Compared on the latest common dataset version"}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} aria-busy={busy || check.loading}>
            {allowed ? "Promote" : "Force promote"}
          </button>
        </>
      }>
      {check.loading && <Loading label="Checking" />}
      {check.data && <Note kind={allowed ? "success" : "error"}>{check.data.detail}</Note>}
      {check.data && <Checks result={check.data} />}
      {check.data && !allowed && (
        <label className="check">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          Promote anyway. The override and its reason are recorded.
        </label>
      )}
      {(allowed || force) && (
        <Field label={allowed ? "Note, optional" : "Reason"}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={allowed ? "Retrained on night sequences" : "Same accuracy, trained on more data"} />
        </Field>
      )}
      {error && <Note kind="error">{error}</Note>}
    </Modal>
  );
}

function RollbackDialog({ project, onClose, onDone }: { project: string; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await models.rollback(project, reason.trim() || undefined);
      onDone(`v${r.version} is back in production${r.deployment ? `, service redeployed` : ""}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Roll back" subtitle="Restores the version that was in production before the current one."
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} aria-busy={busy}>Roll back</button>
        </>
      }>
      <Field label="Reason, optional">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Latency regression on the night shift" />
      </Field>
      {error && <Note kind="error">{error}</Note>}
    </Modal>
  );
}

function Interval({ range }: { range?: [number, number] }) {
  if (!range) return null;
  return (
    <span className="interval" title="95 % interval when the evaluation sequences are resampled">
      {metric(range[0])}–{metric(range[1])}
    </span>
  );
}

function History({ events }: { events: ModelEvent[] }) {
  if (events.length === 0) return <p className="muted">Nothing has happened yet.</p>;
  return (
    <div className="timeline">
      {[...events].reverse().map((e) => (
        <div key={e.id} className="timeline-item">
          <span className="muted">{date(e.created_at)}</span>
          <span><Badge tone={e.action === "rollback" ? "warning" : undefined}>{e.action}</Badge></span>
          <span>
            <span className="mono">{e.from_version ? `v${e.from_version} → ` : ""}v{e.to_version}</span>
            {e.forced && <span style={{ marginLeft: 8 }}><Badge tone="danger">forced</Badge></span>}
            {e.reason && <span className="muted" style={{ marginLeft: 10 }}>{e.reason}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ModelPage() {
  const { project = "" } = useParams();
  const detail = useFetch(() => models.get(project), [project]);
  const summary = useFetch(models.list, []);
  const info = useFetch(models.info, []);
  const [dataset, setDataset] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<number | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cmVersion, setCmVersion] = useState<number | null>(null);
  const [training, setTraining] = useState(false);

  const meta: ModelSummary | undefined = summary.data?.find((m) => m.name === project);
  const versions = detail.data?.versions ?? [];
  const datasets = useMemo(() => {
    const counts = new Map<string, number>();
    versions.forEach((v) => Object.keys(v.evaluations).forEach((d) => counts.set(d, (counts.get(d) ?? 0) + 1)));
    return [...counts.keys()].sort((a, b) =>
      counts.get(b)! - counts.get(a)! || b.localeCompare(a, undefined, { numeric: true }));
  }, [versions]);

  useEffect(() => {
    if (dataset === null && datasets.length) setDataset(datasets[0]);
  }, [datasets, dataset]);

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error) {
    return (
      <>
        <Link to="/models" className="btn ghost small"><ArrowLeft size={14} /> Models</Link>
        <div style={{ marginTop: 16 }}><Note kind="error">{detail.error}</Note></div>
      </>
    );
  }

  const primary = meta?.primary ?? "";
  const evals = dataset ? versions.map((v) => v.evaluations[dataset]?.[primary]).filter((x) => x !== undefined) : [];
  const best = evals.length ? (meta?.higher_is_better ? Math.max(...evals) : Math.min(...evals)) : undefined;
  const available = dataset ? new Set(versions.flatMap((v) => Object.keys(v.evaluations[dataset] ?? {}))) : new Set<string>();
  const watched = (meta?.watch ?? []).filter((k) => k !== primary && available.has(k));
  const others = (watched.length ? watched : [...available].filter((k) => k !== primary)).slice(0, 4);
  const withCm = dataset ? versions.filter((v) => v.evaluations[dataset]) : [];
  const cmShown = withCm.find((v) => v.version === cmVersion)
    ?? withCm.find((v) => v.version === detail.data!.production) ?? withCm[withCm.length - 1];
  const canRollback = detail.data!.history.some((e) => e.to_version === detail.data!.production && e.from_version);

  const done = (m: string) => {
    setPromoting(null);
    setRollingBack(false);
    setMessage(m);
    detail.reload();
    summary.reload();
  };

  return (
    <>
      <Link to="/models" className="btn ghost small" style={{ marginLeft: -12, marginBottom: 12 }}>
        <ArrowLeft size={14} /> Models
      </Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">{meta?.slot ? <Link to="/models" className="mono">{meta.project}</Link> : "model"}</div>
          <h1 className="title">{meta?.slot ?? project}</h1>
          {meta?.description && <div className="subtitle">{meta.description}</div>}
          <div className="subtitle status-line">
            {detail.data!.production ? <Badge tone="success" dot>v{detail.data!.production} in production</Badge> : <Badge>no production version</Badge>}
            {meta && <span>primary metric <span className="mono">{meta.primary}</span><InfoTip metric={meta.primary} custom={meta.descriptions} />, {meta.higher_is_better ? "higher" : "lower"} is better</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {detail.data!.production && <Link className="btn" to={`/production/${project}`}>Production</Link>}
          {canRollback && <button className="btn" onClick={() => setRollingBack(true)}><RotateCcw size={14} /> Roll back</button>}
          {meta && <button className="btn primary" onClick={() => setTraining(true)}><Play size={13} /> Train</button>}
        </div>
      </div>

      {message && <div style={{ marginBottom: 16 }}><Note kind="success">{message}</Note></div>}

      <div className="section-head">
        <h2 className="section-title">Versions</h2>
        {datasets.length > 0 && (
          <span className="status-line">
            <span>evaluated on</span>
            <select className="select mono" value={dataset ?? ""} onChange={(e) => setDataset(e.target.value)}>
              {datasets.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </span>
        )}
      </div>
      <table className="rows">
        <thead>
          <tr>
            <th>version</th><th>variant</th><th>status</th><th>trained on</th>
            <th className="num">{primary.replace(/^mean\./, "")}<InfoTip metric={primary} custom={meta?.descriptions} align="right" /></th>
            {others.map((k) => <th key={k} className="num">{k.replace(/^mean\./, "")}<InfoTip metric={k} custom={meta?.descriptions} align="right" /></th>)}
            <th>run</th><th />
          </tr>
        </thead>
        <tbody>
          {[...versions].reverse().map((v) => {
            const m = dataset ? v.evaluations[dataset] : undefined;
            const value = m?.[primary];
            return (
              <tr key={v.version}>
                <td className="mono" title={v.description ?? undefined}>v{v.version}</td>
                <td>{v.variant ? <span className="mono muted">{v.variant}</span> : <span className="faint">–</span>}</td>
                <td>{statusBadge(v.status)}</td>
                <td>
                  {v.trained_on.length === 0 && <span className="faint">unknown</span>}
                  {v.trained_on.map((ref) => {
                    const [n, ver] = ref.split("@v");
                    return <Link key={ref} to={`/datasets/${n}/v/${ver}`} className="mono" style={{ marginRight: 8, textDecoration: "underline", textDecorationColor: "var(--border-strong)" }}>{ref}</Link>;
                  })}
                </td>
                <td className="num mono" style={{ fontWeight: value !== undefined && value === best ? 600 : 400 }}>
                  {value === undefined ? <span className="faint">not evaluated</span> : metric(value)}
                  <Interval range={dataset ? v.extras?.[dataset]?.intervals?.[primary] : undefined} />
                </td>
                {others.map((k) => (
                  <td key={k} className="num mono muted">
                    {metric(m?.[k])}
                    <Interval range={dataset ? v.extras?.[dataset]?.intervals?.[k] : undefined} />
                  </td>
                ))}
                <td>
                  {info.data && (
                    <a className="mono muted" href={`${info.data.mlflow_url}/#/runs/${v.run_id}`} target="_blank" rel="noreferrer">
                      {v.run_id.slice(0, 8)} <ExternalLink size={11} />
                    </a>
                  )}
                </td>
                <td className="num">
                  {v.status !== "production" && (
                    <button className="btn small" onClick={() => setPromoting(v.version)}>Promote</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {cmShown && dataset && (
        <div className="section">
          <div className="section-head">
            <h2 className="section-title">Version details</h2>
            <span className="status-line">
              <span>version</span>
              <select className="select mono" value={cmShown.version} onChange={(e) => setCmVersion(Number(e.target.value))}>
                {withCm.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}
              </select>
              <span>on <span className="mono">{dataset}</span></span>
            </span>
          </div>
          {meta && <VersionDetails version={cmShown} dataset={dataset} meta={meta} />}
        </div>
      )}

      <div className="section">
        <div className="section-head"><h2 className="section-title">History</h2></div>
        <History events={detail.data!.history} />
      </div>

      {promoting !== null && (
        <PromoteDialog project={project} version={promoting}
          dataset={dataset && versions.find((v) => v.version === promoting)?.evaluations[dataset] ? dataset : null}
          onClose={() => setPromoting(null)} onDone={done} />
      )}
      {training && meta && <TrainDialog project={meta.project} slot={meta.slot} onClose={() => setTraining(false)} />}
      {rollingBack && <RollbackDialog project={project} onClose={() => setRollingBack(false)} onDone={done} />}
    </>
  );
}
