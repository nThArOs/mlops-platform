import { useEffect } from "react";
import { production } from "../api";
import { lookup } from "../lib/glossary";
import { useFetch } from "../lib/useFetch";
import InfoTip from "./InfoTip";
import { Badge, Loading, Note } from "./ui";

type Feature = { name: string; psi: number; level: "stable" | "moderate" | "significant"; buckets: string[]; reference: number[]; current: number[] };

function Bars({ f }: { f: Feature }) {
  const share = (xs: number[]) => {
    const total = xs.reduce((a, b) => a + b, 0) || 1;
    return xs.map((x) => x / total);
  };
  const ref = share(f.reference);
  const cur = share(f.current);
  const max = Math.max(...ref, ...cur, 1e-9);
  const label = (le: string, i: number) => (le === "+Inf" ? `> ${f.buckets[i - 1] ?? "0"}` : `≤ ${le}`);
  return (
    <div className="drift-bars" role="img" aria-label={`${f.name}: reference and current distributions`}>
      {f.buckets.map((le, i) => (
        <div key={le} className="drift-bucket" title={`${label(le, i)}: reference ${(ref[i] * 100).toFixed(1)} %, current ${(cur[i] * 100).toFixed(1)} %`}>
          <div className="drift-pair">
            <span style={{ height: `${(ref[i] / max) * 100}%`, background: "var(--series-1)" }} />
            <span style={{ height: `${(cur[i] / max) * 100}%`, background: "var(--series-2)" }} />
          </div>
          <span className="faint mono drift-label">{label(le, i)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Drift({ project }: { project: string }) {
  const drift = useFetch(() => production.drift(project), [project]);
  useEffect(() => {
    const id = setInterval(drift.reload, 60000);
    return () => clearInterval(id);
  }, [drift.reload]);

  if (drift.loading && !drift.data) return <Loading />;
  if (drift.error) return <Note kind="error">{drift.error}</Note>;
  const d = drift.data!;
  if (!d.ready) return <p className="muted">{d.detail}</p>;
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Distributions of the first {d.window_minutes} min after deployment compared with the last {d.window_minutes} min.
        PSI under 0.1 is stable, over 0.25 is a significant shift.
      </p>
      <div className="chart-legend" style={{ marginBottom: 12 }}>
        <span><span className="key" style={{ background: "var(--series-1)" }} />reference</span>
        <span><span className="key" style={{ background: "var(--series-2)" }} />last {d.window_minutes} min</span>
      </div>
      <div className="charts">
        {(d.features as Feature[]).map((f) => (
          <div key={f.name} className="panel" style={{ padding: "12px 14px" }}>
            <div className="chart-head">
              <span className="chart-title">{lookup(f.name)?.title ?? f.name}<InfoTip metric={f.name} /></span>
              <span className="status-line">
                <span className="mono">PSI {f.psi.toFixed(3)}<InfoTip metric="psi" align="right" /></span>
                <Badge tone={f.level === "stable" ? "success" : f.level === "moderate" ? "warning" : "danger"}>{f.level}</Badge>
              </span>
            </div>
            <Bars f={f} />
          </div>
        ))}
      </div>
      {d.no_data.length > 0 && <p className="faint" style={{ fontSize: 12.5 }}>No traffic in one of the windows for: {d.no_data.join(", ")}.</p>}
    </div>
  );
}
