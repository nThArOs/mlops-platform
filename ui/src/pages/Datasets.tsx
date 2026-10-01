import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../api";
import AddDatasetDialog from "../components/AddDatasetDialog";
import { Loading, Note } from "../components/ui";
import { ago, bytes, count } from "../lib/format";
import { useFetch } from "../lib/useFetch";

export default function DatasetsPage() {
  const navigate = useNavigate();
  const { data, error, loading } = useFetch(api.datasets, []);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">registry</div>
          <h1 className="title">Datasets</h1>
          <div className="subtitle">Every version is immutable and traced to the runs that used it.</div>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Plus size={15} /> Add dataset
        </button>
      </div>

      {loading && !data && <Loading />}
      {error && <Note kind="error">Couldn't load datasets. {error}</Note>}
      {data && data.length === 0 && (
        <div className="empty panel">
          <h2 className="title">Add your first dataset</h2>
          <p>Register a folder or upload a zip. Each change creates a new version.</p>
          <button className="btn primary" onClick={() => setAdding(true)}><Plus size={15} /> Add dataset</button>
        </div>
      )}
      {data && data.length > 0 && (
        <table className="rows">
          <thead>
            <tr>
              <th>name</th>
              <th>latest</th>
              <th className="num">versions</th>
              <th className="num">files</th>
              <th className="num">size</th>
              <th>license</th>
              <th>updated</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.name} className="link" onClick={() => navigate(`/datasets/${d.name}`)}>
                <td><span className="mono" style={{ fontSize: 13.5 }}>{d.name}</span>
                  {d.format && <span className="faint" style={{ marginLeft: 8 }}>{d.format}</span>}</td>
                <td className="mono">v{d.version}</td>
                <td className="num mono">{d.versions}</td>
                <td className="num mono">{count(d.files)}</td>
                <td className="num mono">{bytes(d.bytes)}</td>
                <td><span className="badge">{d.license}</span></td>
                <td className="muted">{ago(d.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding && (
        <AddDatasetDialog
          open={adding}
          onClose={() => setAdding(false)}
          onAdded={(r) => navigate(`/datasets/${r.name}/v/${r.version}`)}
        />
      )}
    </>
  );
}
