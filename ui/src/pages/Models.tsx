import { useNavigate } from "react-router-dom";
import { models } from "../api";
import { Badge, Loading, Note } from "../components/ui";
import { ago } from "../lib/format";
import { useFetch } from "../lib/useFetch";

export default function ModelsPage() {
  const navigate = useNavigate();
  const { data, error, loading } = useFetch(models.list, []);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">registry</div>
          <h1 className="title">Models</h1>
          <div className="subtitle">One registered model per project. A version reaches production only if it beats the current one.</div>
        </div>
      </div>
      {loading && !data && <Loading />}
      {error && <Note kind="error">Couldn't load models. {error}</Note>}
      {data && data.length === 0 && (
        <div className="empty panel">
          <h2 className="title">No model yet</h2>
          <p>Run a project's train entrypoint and its model shows up here as a candidate.</p>
        </div>
      )}
      {data && data.length > 0 && (
        <table className="rows">
          <thead>
            <tr><th>project</th><th>task</th><th className="num">versions</th><th>production</th><th>primary metric</th><th>updated</th></tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.name} className="link" onClick={() => navigate(`/models/${m.name}`)}>
                <td className="mono" style={{ fontSize: 13.5 }}>{m.name}</td>
                <td className="muted">{m.task}</td>
                <td className="num mono">{m.versions}</td>
                <td>{m.production ? <Badge tone="success" dot>v{m.production}</Badge> : <span className="faint">none</span>}</td>
                <td><span className="mono">{m.primary}</span> <span className="faint">{m.higher_is_better ? "higher is better" : "lower is better"}</span></td>
                <td className="muted">{ago(m.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
