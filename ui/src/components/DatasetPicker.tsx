import type { ReactNode } from "react";
import { Help } from "./InfoTip";
import { Badge } from "./ui";

export type Picked = Record<string, number | "">;
export type DatasetHistory = Record<string, { production?: number; latest?: number; latestVersion?: number }>;
type Declared = { name: string; mount: string; versions: number[] };
type Other = { name: string; version: number; license: string };

export function refsOf(picked: Picked): string[] {
  return Object.entries(picked).filter(([, v]) => v !== "").map(([n, v]) => `${n}@v${v}`);
}

export function versionsByName(refs: string[]): Record<string, number> {
  return Object.fromEntries(refs.map((r) => r.split("@v")).map(([n, v]) => [n, Number(v)]));
}

export default function DatasetPicker({ label, help, declared, picked, onChange, history, others, project }: {
  label: string;
  help: ReactNode;
  declared: Declared[];
  picked: Picked;
  onChange: (p: Picked) => void;
  history?: DatasetHistory;
  others?: Other[];
  project: string;
}) {
  const set = (name: string, value: number | "") => onChange({ ...picked, [name]: value });
  return (
    <div className="field">
      <span className="field-label">{label}{help}</span>
      <div className="datasets">
        {declared.map((d) => {
          const on = picked[d.name] !== "" && picked[d.name] !== undefined;
          const h = history?.[d.name];
          const chosen = on ? (picked[d.name] as number) : null;
          return (
            <label key={d.name} className={`dataset-row ${on ? "" : "off"}`}>
              <input type="checkbox" checked={on} onChange={(e) => set(d.name, e.target.checked ? (d.versions[0] ?? "") : "")} />
              <span className="mono">{d.name}</span>
              <span className="faint mono dataset-mount">{d.mount}</span>
              <select className="select mono" value={on ? String(picked[d.name]) : ""} disabled={!on}
                onChange={(e) => set(d.name, Number(e.target.value))} aria-label={`${d.name} version`}>
                {!on && <option value="">–</option>}
                {d.versions.map((v) => <option key={v} value={v}>v{v}</option>)}
              </select>
              <span className="dataset-history faint">
                {history && (h?.production != null ? <>production v{h.production}</> : <>not in production</>)}
                {h?.latest != null && <> · v{h.latestVersion} trained on v{h.latest}</>}
                {chosen != null && h?.production != null && chosen > h.production && <Badge tone="warning">newer than production</Badge>}
                {chosen != null && h?.production != null && chosen < h.production && <Badge>older than production</Badge>}
              </span>
            </label>
          );
        })}
      </div>
      {others && others.length > 0 && (
        <div className="datasets-other">
          <span className="faint" style={{ fontSize: 12.5 }}>
            Other datasets in the registry
            <Help title="Not declared by this project">
              <span>These datasets exist in the platform but {project} does not say where it reads them, so they can't be mounted for its runs.</span>
              <span>To use one, add it to the datasets of project.yaml with the folder the code reads, for example:</span>
              <span className="tip-formula mono">{"datasets:\n  - name: visdrone_mot\n    mount: data/mot/visdrone_mot"}</span>
              <span>The training script must also read that folder.</span>
            </Help>
          </span>
          {others.map((d) => (
            <div key={d.name} className="dataset-row off">
              <span />
              <span className="mono">{d.name}</span>
              <span className="faint mono dataset-mount">not declared</span>
              <span className="faint mono">v{d.version}</span>
              <span className="dataset-history faint">{d.license}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
