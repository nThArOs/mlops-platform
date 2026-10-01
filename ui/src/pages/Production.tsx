import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play, Square } from "lucide-react";
import { production, type Deployment, type LiveMetrics } from "../api";
import LineChart from "../components/LineChart";
import { Badge, Loading, Note, Stat } from "../components/ui";
import { ago } from "../lib/format";
import { useFetch } from "../lib/useFetch";

const RANGES = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
];

const ms = (v: number) => (v >= 100 ? `${v.toFixed(0)} ms` : v >= 1 ? `${v.toFixed(1)} ms` : `${v.toFixed(2)} ms`);
const rps = (v: number) => `${v.toFixed(v >= 10 ? 0 : 1)}/s`;
const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)} %`;
const num = (v: number) => v.toFixed(v >= 10 ? 0 : 1);
const last = (points?: [number, number][]) => (points?.length ? points[points.length - 1][1] : undefined);

function serviceBadge(d: Deployment) {
  if (!d.running) return <Badge>stopped</Badge>;
  if (!d.healthy) return <Badge tone="danger" dot>unhealthy</Badge>;
  return <Badge tone="success" dot>serving</Badge>;
}

export function ProductionList() {
  const navigate = useNavigate();
  const { data, error, loading } = useFetch(production.list, []);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">operations</div>
          <h1 className="title">Production</h1>
          <div className="subtitle">Services running the production version of each model, with live metrics.</div>
        </div>
      </div>
      {loading && !data && <Loading />}
      {error && <Note kind="error">Couldn't load services. {error}</Note>}
      {data && data.length > 0 && (
        <table className="rows">
          <thead><tr><th>project</th><th>service</th><th>deployed</th><th>production</th><th>port</th><th>since</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.project} className="link" onClick={() => navigate(`/production/${d.project}`)}>
                <td className="mono" style={{ fontSize: 13.5 }}>{d.project}</td>
                <td>{d.servable ? serviceBadge(d) : <span className="faint">no serve entrypoint</span>}</td>
                <td className="mono">{d.version ? `v${d.version}` : "–"}</td>
                <td className="mono">{d.production ? `v${d.production}` : "–"}</td>
                <td className="mono muted">{d.running ? d.port : "–"}</td>
                <td className="muted">{d.running && d.started_at ? ago(d.started_at) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Charts({ metrics }: { metrics: LiveMetrics }) {
  const c1 = "var(--series-1)";
  return (
    <div className="charts">
      <LineChart title="Latency" format={ms} series={[
        { name: "p50", points: metrics.latency_p50_ms ?? [], color: c1 },
        { name: "p95", points: metrics.latency_p95_ms ?? [], color: "var(--series-2)" },
      ]} />
      <LineChart title="Throughput, requests per second" format={rps}
        series={[{ name: "requests", points: metrics.requests_per_s ?? [], color: c1 }]} />
      <LineChart title="Error rate" format={pct}
        series={[{ name: "errors", points: metrics.error_rate ?? [], color: c1 }]} />
      <LineChart title="Predictions per input" format={num}
        series={[{ name: "predictions", points: metrics.predictions_per_input ?? [], color: c1 }]} />
      {Object.keys(metrics.stages_ms ?? {}).length > 0 && (
        <LineChart title="Time per frame and stage" format={ms}
          series={Object.keys(metrics.stages_ms!).sort().slice(0, 3).map((stage, i) => ({
            name: stage, points: metrics.stages_ms![stage], color: `var(--series-${i + 1})`,
          }))} />
      )}
      {(metrics.confidence_mean?.length ?? 0) > 0 && (
        <LineChart title="Mean confidence" format={(v) => v.toFixed(2)}
          series={[{ name: "confidence", points: metrics.confidence_mean ?? [], color: c1 }]} />
      )}
    </div>
  );
}

export function ProductionService() {
  const { project = "" } = useParams();
  const [minutes, setMinutes] = useState(60);
  const status = useFetch(() => production.get(project), [project]);
  const metrics = useFetch(() => production.metrics(project, minutes), [project, minutes]);
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      status.reload();
      metrics.reload();
    }, 10000);
    return () => clearInterval(id);
  }, [status.reload, metrics.reload]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      status.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status.loading && !status.data) return <Loading />;
  const d = status.data;
  const m = metrics.data ?? {};

  return (
    <>
      <Link to="/production" className="btn ghost small" style={{ marginLeft: -12, marginBottom: 12 }}>
        <ArrowLeft size={14} /> Production
      </Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">{project}</div>
          <h1 className="title">{d?.version ? `Version ${d.version}` : "Not deployed"}</h1>
          {d && (
            <div className="subtitle status-line">
              {serviceBadge(d)}
              {d.running && d.started_at && <span>since {ago(d.started_at)}</span>}
              {d.running && <span className="mono">127.0.0.1:{d.port}</span>}
              {d.profile && <span>profile <span className="mono">{d.profile}</span></span>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn" to={`/models/${project}`}>Model versions</Link>
          {d?.running ? (
            <button className="btn danger" aria-busy={busy}
              onClick={() => window.confirm(`Stop the ${project} service?`) && act(() => production.stop(project))}>
              <Square size={13} /> Stop
            </button>
          ) : (
            <button className="btn primary" aria-busy={busy} onClick={() => act(() => production.start(project))}>
              <Play size={13} /> Start{d?.production ? ` v${d.production}` : ""}
            </button>
          )}
        </div>
      </div>

      {status.error && <Note kind="error">{status.error}</Note>}
      {error && <div style={{ marginBottom: 16 }}><Note kind="error">{error}</Note></div>}
      {d?.running && d.production && d.version !== d.production && (
        <div style={{ marginBottom: 16 }}>
          <Note kind="error">The service runs v{d.version} but v{d.production} is in production. Restart it to deploy v{d.production}.</Note>
        </div>
      )}

      <div className="stats">
        <Stat label="Latency p95" value={last(m.latency_p95_ms) !== undefined ? ms(last(m.latency_p95_ms)!) : "–"} />
        <Stat label="Throughput" value={last(m.requests_per_s) !== undefined ? rps(last(m.requests_per_s)!) : "–"} />
        <Stat label="Error rate" value={last(m.error_rate) !== undefined ? pct(last(m.error_rate)!) : "–"} />
        <Stat label={m.confidence_mean?.length ? "Mean confidence" : "Predictions per input"}
          value={m.confidence_mean?.length ? last(m.confidence_mean)!.toFixed(2)
            : last(m.predictions_per_input) !== undefined ? num(last(m.predictions_per_input)!) : "–"} />
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Live metrics</h2>
          <div className="segmented">
            {RANGES.map((r) => (
              <button key={r.label} className={minutes === r.minutes ? "on" : ""} onClick={() => setMinutes(r.minutes)}>{r.label}</button>
            ))}
          </div>
        </div>
        {metrics.error && <Note kind="error">{metrics.error}</Note>}
        {!metrics.data && metrics.loading && <Loading />}
        {metrics.data && <Charts metrics={metrics.data} />}
        <p className="faint" style={{ fontSize: 12.5, marginTop: 16 }}>Refreshed every 10 seconds from Prometheus.</p>
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Logs</h2>
          <button className="btn small" onClick={async () => setLogs((await production.logs(project)).logs)}>
            {logs === null ? "Show logs" : "Refresh"}
          </button>
        </div>
        {logs !== null && <pre className="panel logs">{logs || "No output."}</pre>}
      </div>
    </>
  );
}
