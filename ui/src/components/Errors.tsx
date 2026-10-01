import { useMemo, useState } from "react";
import type { ModelVersion } from "../api";
import { useFetch } from "../lib/useFetch";
import { Help } from "./InfoTip";
import { Note } from "./ui";

type Example = { id: string; kind: "fn" | "fp"; sequence: string; frame: number; size: number; conf?: number; image: string | null };
type Errors = { run_id: string; input?: string; examples: Example[] | null };

const KINDS = { fn: "Missed objects", fp: "False alarms" } as const;
const SHOWN = 60;

function load(model: string, version: number | null, dataset: string) {
  return version === null ? Promise.resolve(null)
    : (fetch(`/api/models/${model}/versions/${version}/errors?dataset=${encodeURIComponent(dataset)}`)
      .then((r) => (r.ok ? r.json() : null)) as Promise<Errors | null>);
}

export default function ErrorExplorer({ model, version, dataset, versions }: {
  model: string; version: ModelVersion; dataset: string; versions: ModelVersion[];
}) {
  const [kind, setKind] = useState<"fn" | "fp">("fn");
  const [sequence, setSequence] = useState("");
  const [other, setOther] = useState<number | null>(null);
  const [view, setView] = useState<"all" | "new" | "fixed">("all");
  const mine = useFetch(() => load(model, version.version, dataset), [model, version.version, dataset]);
  const theirs = useFetch(() => load(model, other, dataset), [model, other, dataset]);
  const comparable = versions.filter((v) => v.version !== version.version && v.evaluations[dataset]);

  const a = mine.data?.examples;
  const b = theirs.data?.examples;
  const diff = useMemo(() => {
    if (!a || !b) return null;
    const ida = new Set(a.filter((e) => e.kind === kind).map((e) => e.id));
    const idb = new Set(b.filter((e) => e.kind === kind).map((e) => e.id));
    return { added: a.filter((e) => e.kind === kind && !idb.has(e.id)), fixed: b.filter((e) => e.kind === kind && !ida.has(e.id)) };
  }, [a, b, kind]);

  if (mine.loading) return null;
  if (!a) return <p className="muted">This evaluation didn't save its errors. Projects can write an <span className="mono">errors</span> output (see the contract) to browse them here.</p>;

  const source = view === "new" && diff ? diff.added : view === "fixed" && diff ? diff.fixed : a.filter((e) => e.kind === kind);
  const runOf = view === "fixed" ? theirs.data!.run_id : mine.data!.run_id;
  const sequences = [...new Set(a.map((e) => e.sequence))].sort();
  const listed = source.filter((e) => !sequence || e.sequence === sequence);
  const withImage = listed.filter((e) => e.image).slice(0, SHOWN);

  return (
    <div>
      <div className="live-bar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="segmented">
          {(["fn", "fp"] as const).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
              {KINDS[k]} <span className="faint">{a.filter((e) => e.kind === k).length}</span>
            </button>
          ))}
        </div>
        <select className="select mono" value={sequence} onChange={(e) => setSequence(e.target.value)} aria-label="Sequence">
          <option value="">all sequences</option>
          {sequences.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select mono" value={other ?? ""} aria-label="Compare with"
          onChange={(e) => { setOther(e.target.value ? Number(e.target.value) : null); setView(e.target.value ? "new" : "all"); }}>
          <option value="">compare with…</option>
          {comparable.map((v) => <option key={v.version} value={v.version}>v{v.version}{v.variant ? ` ${v.variant}` : ""}</option>)}
        </select>
        {diff && (
          <div className="segmented">
            <button className={view === "new" ? "on" : ""} onClick={() => setView("new")}>New in v{version.version} <span className="faint">{diff.added.length}</span></button>
            <button className={view === "fixed" ? "on" : ""} onClick={() => setView("fixed")}>Fixed since v{other} <span className="faint">{diff.fixed.length}</span></button>
            <button className={view === "all" ? "on" : ""} onClick={() => setView("all")}>All</button>
          </div>
        )}
        <Help title="Errors">
          <span>Every missed object and false alarm of the evaluation, with thumbnails for a random sample: the decoded frame on the left, the model input on the right, green box for a missed object, red for a false alarm.</span>
          <span>Comparing two versions matches missed objects by annotation and false alarms by position, frame by frame.</span>
        </Help>
      </div>
      <p className="faint" style={{ fontSize: 12.5 }}>
        {listed.length} {KINDS[kind].toLowerCase()}{sequence ? ` in ${sequence}` : ""}, {withImage.length} shown
        {view === "fixed" && other ? ` (thumbnails from v${other})` : ""}.
      </p>
      {theirs.loading && other !== null && <p className="muted">Loading v{other}…</p>}
      {other !== null && !theirs.loading && !b && <Note kind="error">v{other} has no saved errors on {dataset}.</Note>}
      <div className="gallery">
        {withImage.map((e) => (
          <figure key={e.id}>
            <img loading="lazy" src={`/api/errors/${runOf}/${e.image}`} alt={`${e.kind === "fn" ? "Missed object" : "False alarm"} in ${e.sequence} frame ${e.frame}`} />
            <figcaption className="mono">{e.sequence} #{e.frame} · {Math.round(e.size)} px{e.conf !== undefined ? ` · ${e.conf.toFixed(2)}` : ""}</figcaption>
          </figure>
        ))}
      </div>
      {listed.length > 0 && withImage.length === 0 && <p className="muted">No thumbnail in this selection: only a sample of the errors has one.</p>}
    </div>
  );
}

