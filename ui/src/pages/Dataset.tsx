import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Archive, GitCompare, Plus } from "lucide-react";
import { api, type Diff } from "../api";
import AddDatasetDialog from "../components/AddDatasetDialog";
import FileBrowser from "../components/FileBrowser";
import { Badge, Loading, Note, Stat } from "../components/ui";
import { ago, bytes, count, date, files } from "../lib/format";
import { useFetch } from "../lib/useFetch";

function CompareSection({ name, version, versions }: { name: string; version: number; versions: number[] }) {
  const others = versions.filter((v) => v !== version);
  const [other, setOther] = useState<number | null>(others[0] ?? null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (others.length === 0) return <p className="muted">There's only one version, nothing to compare yet.</p>;

  async function run() {
    if (other === null) return;
    setError(null);
    try {
      setDiff(await api.diff(name, Math.min(other, version), Math.max(other, version)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const lines = diff ? [
    ...diff.added.map((p) => ["added", "+", p]),
    ...diff.removed.map((p) => ["removed", "-", p]),
    ...diff.modified.map((p) => ["modified", "~", p]),
  ] : [];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <span className="muted">Compare v{version} with</span>
        <select className="select mono" value={other ?? ""} onChange={(e) => { setOther(Number(e.target.value)); setDiff(null); }}>
          {others.map((v) => <option key={v} value={v}>v{v}</option>)}
        </select>
        <button className="btn small" onClick={run}><GitCompare size={14} /> Compare</button>
      </div>
      {error && <Note kind="error">{error}</Note>}
      {diff && (
        <div className="panel" style={{ padding: "12px 16px" }}>
          <div className="muted" style={{ marginBottom: 8 }}>
            {diff.added.length} added, {diff.removed.length} removed, {diff.modified.length} modified
            {other !== null && ` from v${Math.min(other, version)} to v${Math.max(other, version)}`}
          </div>
          {lines.length === 0 && <div className="muted">Same content.</div>}
          {lines.slice(0, 500).map(([k, sign, p]) => (
            <div key={`${k}${p}`} className={`diff-line ${k}`}>{sign} {p}</div>
          ))}
          {lines.length > 500 && <div className="faint">and {count(lines.length - 500)} more</div>}
        </div>
      )}
    </div>
  );
}

export default function DatasetPage() {
  const { name = "", version: versionParam } = useParams();
  const navigate = useNavigate();
  const dataset = useFetch(() => api.dataset(name), [name]);
  const versions = dataset.data?.versions ?? [];
  const active = versions.filter((v) => !v.archived);
  const selected = versionParam ? Number(versionParam) : active[0]?.version;
  const current = versions.find((v) => v.version === selected);
  const detail = useFetch(
    () => (selected ? api.version(name, selected) : Promise.resolve(null)),
    [name, selected],
  );
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (dataset.loading && !dataset.data) return <Loading />;
  if (dataset.error) {
    return (
      <>
        <Link to="/datasets" className="btn ghost small"><ArrowLeft size={14} /> Datasets</Link>
        <div style={{ marginTop: 16 }}><Note kind="error">{dataset.error}</Note></div>
      </>
    );
  }
  const d = dataset.data!;

  async function archive() {
    if (!current) return;
    setActionError(null);
    if (!window.confirm(`Archive ${name}@v${current.version}? It stays stored but is hidden and can't be used for new runs.`)) return;
    try {
      await api.archive(name, current.version);
      navigate(`/datasets/${name}`);
      dataset.reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  return (
    <>
      <Link to="/datasets" className="btn ghost small" style={{ marginLeft: -12, marginBottom: 12 }}>
        <ArrowLeft size={14} /> Datasets
      </Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">dataset</div>
          <h1 className="title">{d.name}</h1>
          <div className="subtitle" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Badge>{d.license}</Badge>
            {d.format && <Badge>{d.format}</Badge>}
            {d.description && <span>{d.description}</span>}
          </div>
          {d.source && <div className="mono faint" style={{ marginTop: 6 }}>{d.source}</div>}
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={15} /> New version</button>
      </div>

      <div className="layout-2">
        <div>
          <div className="nav-label" style={{ padding: "0 12px 6px" }}>versions</div>
          <div className="version-list">
            {versions.map((v) => (
              <button key={v.id} className={`version-item ${v.version === selected ? "on" : ""}`}
                onClick={() => navigate(`/datasets/${name}/v/${v.version}`)}>
                <span className="line">
                  <span className="mono" style={{ fontSize: 14 }}>v{v.version}</span>
                  {v.in_production && <Badge tone="success" dot>production</Badge>}
                  {v.archived && <Badge>archived</Badge>}
                </span>
                <span className="faint" style={{ fontSize: 12.5 }}>
                  {files(v.files)} · {bytes(v.bytes)} · {ago(v.created_at)}
                </span>
                {v.note && <span className="muted" style={{ fontSize: 12.5 }}>{v.note}</span>}
              </button>
            ))}
          </div>
        </div>

        <div>
          {!current && <Note>This dataset has no active version.</Note>}
          {current && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <h2 className="section-title">Version {current.version}</h2>
                {!current.archived && (
                  <button className="btn small danger" onClick={archive}><Archive size={14} /> Archive</button>
                )}
              </div>
              {actionError && <div style={{ marginBottom: 12 }}><Note kind="error">{actionError}</Note></div>}
              <div className="stats">
                <Stat label="Files" value={count(current.files)} />
                <Stat label="Size" value={bytes(current.bytes)} />
                <Stat label="Runs" value={current.runs} />
                <Stat label="Created" value={<span style={{ fontSize: 14 }}>{date(current.created_at)}</span>} />
              </div>
              <div className="mono faint" style={{ marginTop: 10, wordBreak: "break-all" }}>
                manifest {current.manifest_hash}
              </div>

              {Object.keys(current.splits).length > 0 && (
                <div className="section" style={{ marginTop: 24 }}>
                  <div className="section-head"><h3 className="section-title" style={{ fontSize: 18 }}>Splits</h3></div>
                  <div className="stats">
                    {Object.entries(current.splits).map(([s, info]) => (
                      <Stat key={s} label={`${s} · ${info.path}/`} value={count(info.files)} />
                    ))}
                  </div>
                </div>
              )}

              <div className="section">
                <div className="section-head"><h3 className="section-title">Files</h3></div>
                {current.archived ? <Note>Archived versions can't be browsed.</Note> : <FileBrowser name={name} version={current.version} />}
              </div>

              <div className="section">
                <div className="section-head"><h3 className="section-title">Used by</h3></div>
                {detail.loading && !detail.data && <Loading />}
                {detail.data && detail.data.usage.length === 0 && <p className="muted">No run has used this version yet.</p>}
                {detail.data && detail.data.usage.length > 0 && (
                  <table className="rows">
                    <thead><tr><th>run</th><th>project</th><th>entrypoint</th><th>mounted at</th><th>when</th></tr></thead>
                    <tbody>
                      {detail.data.usage.map((u) => (
                        <tr key={u.run_id}>
                          <td className="mono">{u.run_id.slice(0, 12)}</td>
                          <td>{u.project}</td>
                          <td><Badge>{u.entrypoint}</Badge></td>
                          <td className="mono muted">{u.mount}</td>
                          <td className="muted">{ago(u.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="section">
                <div className="section-head"><h3 className="section-title">Compare</h3></div>
                <CompareSection name={name} version={current.version} versions={active.map((v) => v.version)} />
              </div>
            </>
          )}
        </div>
      </div>

      {adding && (
        <AddDatasetDialog
          open={adding}
          onClose={() => setAdding(false)}
          dataset={{ name, splits: Object.fromEntries(Object.entries(current?.splits ?? {}).map(([k, v]) => [k, v.path])) }}
          onAdded={(r) => {
            setAdding(false);
            dataset.reload();
            navigate(`/datasets/${name}/v/${r.version}`);
          }}
        />
      )}
    </>
  );
}
