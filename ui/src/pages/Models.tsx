import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { models, type ModelSummary } from "../api";
import { Badge, Loading, Note } from "../components/ui";
import { ago } from "../lib/format";
import { useFetch } from "../lib/useFetch";

export default function ModelsPage() {
  const navigate = useNavigate();
  const { data, error, loading } = useFetch(models.list, []);
  const groups = new Map<string, ModelSummary[]>();
  data?.forEach((m) => groups.set(m.project, [...(groups.get(m.project) ?? []), m]));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">registry</div>
          <h1 className="title">Models</h1>
          <div className="subtitle">Each project can hold several models. Each model has its own versions and its own production version.</div>
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
            <tr><th>model</th><th className="num">versions</th><th>production</th><th>primary metric</th><th>updated</th></tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([project, items]) => (
              <Fragment key={project}>
                {items.some((m) => m.slot) && (
                  <tr><td colSpan={5} className="group-row"><span className="mono">{project}</span>
                    {items[0].task && <span className="faint" style={{ marginLeft: 8 }}>{items[0].task}</span>}</td></tr>
                )}
                {items.map((m) => (
                  <tr key={m.name} className="link" onClick={() => navigate(`/models/${m.name}`)}>
                    <td style={{ paddingLeft: m.slot ? 28 : 12 }}>
                      <div className="mono" style={{ fontSize: 13.5 }}>{m.slot ?? m.name}</div>
                      {(m.description || (!m.slot && m.task)) && <div className="faint" style={{ fontSize: 12.5 }}>{m.description ?? m.task}</div>}
                    </td>
                    <td className="num mono">{m.versions}</td>
                    <td>{m.production ? <Badge tone="success" dot>v{m.production}</Badge> : <span className="faint">none</span>}</td>
                    <td><span className="mono">{m.primary}</span> <span className="faint">{m.higher_is_better ? "higher is better" : "lower is better"}</span></td>
                    <td className="muted">{ago(m.updated_at)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
