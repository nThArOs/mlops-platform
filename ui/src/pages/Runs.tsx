import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Square } from "lucide-react";
import { jobs, models, type Job } from "../api";
import InfoTip from "../components/InfoTip";
import { Badge, Loading, Note, Stat } from "../components/ui";
import { ago, date } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { PromoteDialog } from "./Model";

export function statusBadge(status: Job["status"]) {
  if (status === "running") return <Badge tone="warning" dot>running</Badge>;
  if (status === "finished") return <Badge tone="success">finished</Badge>;
  if (status === "failed") return <Badge tone="danger">failed</Badge>;
  return <Badge>{status}</Badge>;
}

function duration(job: Job): string {
  if (!job.started_at) return "–";
  const s = ((job.finished_at ? new Date(job.finished_at) : new Date()).getTime() - new Date(job.started_at).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

const label = (job: Job) => (job.entrypoint === "evaluate" ? job.spec.model ?? job.model : job.spec.variant ?? job.spec.config?.split("/").pop());

export function RunsList() {
  const navigate = useNavigate();
  const list = useFetch(() => jobs.list(), []);
  useEffect(() => {
    const id = setInterval(list.reload, 5000);
    return () => clearInterval(id);
  }, [list.reload]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">jobs</div>
          <h1 className="title">Runs</h1>
          <div className="subtitle">Trainings and evaluations started from the platform, run one at a time.</div>
        </div>
      </div>
      {list.loading && !list.data && <Loading />}
      {list.error && <Note kind="error">{list.error}</Note>}
      {list.data && list.data.length === 0 && (
        <div className="empty panel">
          <h2 className="title">No run yet</h2>
          <p>Open a model and use “Train” to queue a training.</p>
          <Link className="btn" to="/models">Go to models</Link>
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <table className="rows">
          <thead><tr><th>#</th><th>model</th><th>job</th><th>variant / model</th><th>status</th><th>queued</th><th>duration</th></tr></thead>
          <tbody>
            {list.data.map((j) => (
              <tr key={j.id} className="link" onClick={() => navigate(`/runs/${j.id}`)}>
                <td className="mono muted">{j.id}</td>
                <td className="mono">{j.model}</td>
                <td><Badge>{j.entrypoint}</Badge>{j.parent_id && <span className="faint" style={{ marginLeft: 6 }}>after #{j.parent_id}</span>}</td>
                <td className="mono muted">{label(j)}</td>
                <td>{statusBadge(j.status)}</td>
                <td className="muted">{ago(j.created_at)}</td>
                <td className="mono muted">{duration(j)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Log({ job }: { job: Job }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLPreElement>(null);
  const live = job.status === "running" || job.status === "cancelling" || job.status === "queued";

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await jobs.log(job.id, -1);
      if (!alive) return;
      const el = ref.current;
      const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      setText(r.text);
      if (atBottom) requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight));
    };
    load();
    if (!live) return () => { alive = false; };
    const id = setInterval(load, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [job.id, live]);

  return <pre ref={ref} className="panel logs" style={{ maxHeight: 420 }}>{text || (job.status === "queued" ? "Waiting for the previous run to finish." : "No output yet.")}</pre>;
}

function Comparison({ job }: { job: Job }) {
  const reg = job.result?.registered;
  const detail = useFetch(() => (reg ? models.get(reg.model) : Promise.resolve(null)), [reg?.model, reg?.version]);
  const list = useFetch(models.list, []);
  const check = useFetch(() => (reg ? models.check(reg.model, reg.version) : Promise.resolve(null)), [reg?.model, reg?.version]);
  const [promoting, setPromoting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!reg) return null;
  const meta = list.data?.find((m) => m.name === reg.model);
  const versions = detail.data?.versions ?? [];
  const mine = versions.find((v) => v.version === reg.version);
  const prod = versions.find((v) => v.version === detail.data?.production);
  if (!meta || !mine) return <Loading />;
  const refs = Object.keys(mine.evaluations);
  const ref = refs.find((r) => prod?.evaluations[r]) ?? refs[0];
  const keys = [meta.primary, ...meta.watch.filter((k) => k !== meta.primary)].filter((k) => ref && mine.evaluations[ref]?.[k] !== undefined).slice(0, 6);

  return (
    <div className="section">
      <div className="section-head">
        <h2 className="section-title">Result</h2>
        <Link to={`/models/${reg.model}`} style={{ textDecoration: "underline", textDecorationColor: "var(--border-strong)" }}>all versions</Link>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Registered <span className="mono">{reg.model}@v{reg.version}</span>
        {mine.variant && <> · variant <span className="mono">{mine.variant}</span></>}
        {ref ? <> · evaluated on <span className="mono">{ref}</span></> : " · not evaluated yet"}
      </p>
      {ref && (
        <div className="stats">
          {keys.map((k) => {
            const a = mine.evaluations[ref][k];
            const b = prod?.version !== mine.version ? prod?.evaluations[ref]?.[k] : undefined;
            const delta = b === undefined ? null : a - b;
            return (
              <Stat key={k} label={<>{k.replace(/^mean\./, "")}<InfoTip metric={k} custom={meta.descriptions} /></>}
                value={<>
                  {a.toFixed(Math.abs(a) >= 100 ? 0 : 2)}
                  {delta !== null && (
                    <span className="faint" style={{ fontSize: 12.5, marginLeft: 8 }}>
                      {delta >= 0 ? "+" : ""}{delta.toFixed(2)} vs v{prod!.version}
                    </span>
                  )}
                </>} />
            );
          })}
        </div>
      )}
      {check.data && (
        <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Note kind={check.data.allowed ? "success" : "info"}>{check.data.detail}</Note>
          {mine.status !== "production" && (
            <button className={`btn ${check.data.allowed ? "primary" : ""}`} onClick={() => setPromoting(true)}>Promote v{reg.version}</button>
          )}
        </div>
      )}
      {message && <div style={{ marginTop: 12 }}><Note kind="success">{message}</Note></div>}
      {promoting && (
        <PromoteDialog project={reg.model} version={reg.version} dataset={ref ?? null} onClose={() => setPromoting(false)}
          onDone={(m) => { setPromoting(false); setMessage(m); detail.reload(); check.reload(); }} />
      )}
    </div>
  );
}

export function RunPage() {
  const { id = "" } = useParams();
  const job = useFetch(() => jobs.get(Number(id)), [id]);
  const child = useFetch(() => (job.data?.children?.length ? jobs.get(job.data.children[0]) : Promise.resolve(null)),
    [job.data?.children?.[0], job.data?.status]);
  const [error, setError] = useState<string | null>(null);
  const j = job.data;
  const active = j && ["queued", "running", "cancelling"].includes(j.status);
  const childActive = child.data && ["queued", "running", "cancelling"].includes(child.data.status);

  useEffect(() => {
    if (!active && !childActive) return;
    const t = setInterval(() => { job.reload(); child.reload(); }, 3000);
    return () => clearInterval(t);
  }, [active, childActive, job.reload, child.reload]);

  if (job.loading && !j) return <Loading />;
  if (job.error || !j) return <Note kind="error">{job.error}</Note>;
  const params = Object.entries(j.spec.params ?? {});
  const evaluated = j.entrypoint === "train" && (child.data?.status === "finished" || j.result?.evaluated);

  return (
    <>
      <Link to="/runs" className="btn ghost small" style={{ marginLeft: -12, marginBottom: 12 }}><ArrowLeft size={14} /> Runs</Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">{j.model}</div>
          <h1 className="title">{j.entrypoint === "train" ? "Training" : "Evaluation"} #{j.id}</h1>
          <div className="subtitle status-line">
            {statusBadge(j.status)}
            <span>queued {ago(j.created_at)}</span>
            {j.started_at && <span>· {duration(j)}</span>}
            {j.parent_id && <Link to={`/runs/${j.parent_id}`}>after #{j.parent_id}</Link>}
          </div>
        </div>
        {active && (
          <button className="btn danger" onClick={async () => {
            if (!window.confirm(`Cancel run #${j.id}?`)) return;
            try { await jobs.cancel(j.id); job.reload(); } catch (e) { setError((e as Error).message); }
          }}><Square size={13} /> Cancel</button>
        )}
      </div>
      {error && <Note kind="error">{error}</Note>}
      {j.error && j.status === "failed" && <Note kind="error">{j.error}. See the log below.</Note>}

      <div className="stats">
        <Stat label="Config" value={<span style={{ fontSize: 13 }}>{j.spec.config ?? "–"}</span>} />
        <Stat label="Datasets" value={<span style={{ fontSize: 13 }}>{(j.spec.datasets ?? []).join(", ") || "–"}</span>} />
        <Stat label="Profile" value={<span style={{ fontSize: 13 }}>{j.spec.profile ?? "default"}</span>} />
        <Stat label={j.entrypoint === "evaluate" ? "Model" : "Variant"} value={<span style={{ fontSize: 13 }}>{label(j) ?? "–"}</span>} />
      </div>
      {params.length > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Changed parameters: {params.map(([k, v]) => <span key={k} className="mono" style={{ marginRight: 12 }}>{k} = {JSON.stringify(v)}</span>)}
        </p>
      )}

      {j.entrypoint === "train" && j.spec.auto_evaluate && (
        <p className="muted">
          {child.data
            ? <>Evaluation <Link to={`/runs/${child.data.id}`} className="mono" style={{ textDecoration: "underline" }}>#{child.data.id}</Link> {statusBadge(child.data.status)}</>
            : j.status === "finished" ? "No version registered, nothing to evaluate." : "The new version will be evaluated when training ends."}
        </p>
      )}

      {evaluated && <Comparison job={j} />}
      {j.entrypoint === "evaluate" && j.status === "finished" && j.spec.model && (
        <p className="muted">Results are on the <Link to={`/models/${j.model}`} style={{ textDecoration: "underline" }}>model page</Link>.</p>
      )}

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Log</h2>
          {j.started_at && <span className="faint">{date(j.started_at)}</span>}
        </div>
        <Log job={j} />
      </div>
    </>
  );
}
