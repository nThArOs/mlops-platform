import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jobs, models } from "../api";
import { paramHelp } from "../lib/params";
import { useFetch } from "../lib/useFetch";
import { Help } from "./InfoTip";
import { ProfilePicker } from "./Benchmarks";
import { Field, Loading, Modal, Note } from "./ui";

type Flat = Record<string, unknown>;

function flatten(obj: Record<string, unknown>, prefix = ""): Flat {
  const out: Flat = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}

function unflatten(flat: Flat): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let node = out;
    parts.slice(0, -1).forEach((p) => { node = (node[p] ??= {}) as Record<string, unknown>; });
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

function coerce(raw: string, original: unknown): unknown {
  if (typeof original === "number") return raw.trim() === "" || Number.isNaN(Number(raw)) ? raw : Number(raw);
  if (typeof original === "boolean") return raw === "true";
  if (Array.isArray(original)) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

const show = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v) : String(v ?? ""));

export default function TrainDialog({ project, slot, benchProfiles = [], constraints = {}, onClose }: {
  project: string;
  slot: string | null;
  benchProfiles?: string[];
  constraints?: Record<string, Record<string, number>>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const options = useFetch(() => jobs.options(project), [project]);
  const key = slot ? `${project}.${slot}` : project;
  const registry = useFetch(() => models.get(key).catch(() => null), [key]);
  const [evalPicked, setEvalPicked] = useState<Record<string, number | "">>({});
  const [config, setConfig] = useState<string | null>(null);
  const base = useFetch(() => (config ? jobs.config(project, config) : Promise.resolve(null)), [project, config]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, number | "">>({});
  const [profile, setProfile] = useState("");
  const [variant, setVariant] = useState("");
  const [evaluate, setEvaluate] = useState(true);
  const [bench, setBench] = useState<string[]>(benchProfiles);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const o = options.data;
  useEffect(() => {
    if (!o) return;
    setConfig((c) => c ?? o.entrypoints.train?.config ?? o.configs[0] ?? null);
    setProfile((p) => p || o.default_profile);
    setPicked((p) => (Object.keys(p).length ? p : Object.fromEntries(o.datasets.map((d) => [d.name, d.versions[0] ?? ""]))));
  }, [o]);

  const flat = useMemo(() => flatten(base.data?.values ?? {}), [base.data]);
  const profileDetails = Object.fromEntries((o?.profiles ?? []).map((p) => [p.name, [
    p.cpus ? `${p.cpus} CPU, ${p.memory}` : "whole machine",
    constraints[p.name] ? "limits: " + Object.entries(constraints[p.name]).map(([k, v]) => `${k} ${v}`).join(", ") : "",
  ].filter(Boolean).join(" · ")]));
  useEffect(() => { setValues(Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, show(v)]))); }, [flat]);

  useEffect(() => {
    if (!o || registry.loading || Object.keys(evalPicked).length) return;
    const prod = registry.data?.versions.find((v) => v.version === registry.data?.production);
    const prodRefs = Object.keys(prod?.evaluations ?? {});
    setEvalPicked(Object.fromEntries(o.datasets.map((d) => {
      const ref = prodRefs.find((r) => r.startsWith(`${d.name}@v`));
      return [d.name, ref ? Number(ref.split("@v")[1]) : (picked[d.name] ?? d.versions[0] ?? "")];
    })));
  }, [o, registry.loading, registry.data, picked, evalPicked]);

  const changed = Object.entries(values).filter(([k, v]) => v !== show(flat[k]));
  const evalRefs = Object.entries(evalPicked).filter(([, v]) => v !== "").map(([n, v]) => `${n}@v${v}`);
  const refs = Object.entries(picked).filter(([, v]) => v !== "").map(([n, v]) => `${n}@v${v}`);

  async function submit() {
    if (!config) return setError("Choose a config to start from.");
    if (refs.length === 0) return setError("Mount at least one dataset.");
    setBusy(true);
    setError(null);
    try {
      const job = await jobs.create({
        project, slot, entrypoint: "train", config,
        params: unflatten(Object.fromEntries(changed.map(([k, v]) => [k, coerce(v, flat[k])]))),
        datasets: refs, profile, variant: variant.trim() || undefined,
        auto_evaluate: evaluate, eval_datasets: evalRefs.length ? evalRefs : refs, benchmark_profiles: bench,
      });
      navigate(`/runs/${job.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Train a new version"
      subtitle={`${slot ? `${project}.${slot}` : project}. The run is queued and starts when the previous one is done.`}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} aria-busy={busy}>Queue training</button>
        </>
      }>
      {options.loading && !o && <Loading />}
      {options.error && <Note kind="error">{options.error}</Note>}
      {o && (
        <>
          <div className="form-grid">
            <Field label="Start from config" full help={
              <Help title="Config">
                <span>A YAML file of the project with the training settings. Its values are listed below and can be changed for this run only; the file itself stays untouched and the changed copy is saved with the run.</span>
              </Help>}
              hint={base.data?.description ?? undefined}>
              <select className="select mono" value={config ?? ""} onChange={(e) => setConfig(e.target.value)}>
                {o.configs.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Variant label" hint="Shown in the versions table. Default: the config name." help={
              <Help title="Variant">
                <span>A short name for what is different in this version: the architecture, the number of epochs, the data. It helps to read the versions table and the accuracy against latency chart.</span>
              </Help>}>
              <input className="input mono" value={variant} onChange={(e) => setVariant(e.target.value)}
                placeholder={config?.split("/").pop()?.replace(/\.ya?ml$/, "") ?? ""} />
            </Field>
            <Field label="Hardware profile" help={
              <Help title="Hardware profile">
                <span>CPU and memory limits of the training container. Use pc-cpu to train on the whole machine; limited profiles are meant for benchmarks.</span>
              </Help>}>
              <select className="select mono" value={profile} onChange={(e) => setProfile(e.target.value)}>
                {o.profiles.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}{p.cpus ? ` (${p.cpus} CPU, ${p.memory})` : ""}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="field">
            <span className="field-label">Datasets<Help title="Datasets">
              <span>Each dataset version is mounted read-only where the project expects it. The run is linked to these exact versions, so the new model always knows what it was trained on.</span>
            </Help></span>
            {o.datasets.map((d) => (
              <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ flex: 1 }}>{d.name}</span>
                <span className="faint mono" style={{ fontSize: 12 }}>{d.mount}</span>
                <select className="select mono" value={picked[d.name] ?? ""}
                  onChange={(e) => setPicked({ ...picked, [d.name]: e.target.value === "" ? "" : Number(e.target.value) })}>
                  <option value="">not mounted</option>
                  {d.versions.map((v) => <option key={v} value={v}>v{v}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div className="field">
            <span className="field-label">Parameters{changed.length > 0 && <span className="faint"> · {changed.length} changed</span>}<Help title="Parameters">
              <span>Values of the chosen config. Changed values are outlined and only apply to this run. Hover the icon of a parameter to see what it does.</span>
            </Help></span>
            {base.loading && <Loading label="Reading config" />}
            <div className="params">
              {Object.keys(flat).map((k) => (
                <label key={k} className={`param ${values[k] !== show(flat[k]) ? "changed" : ""}`}>
                  <span className="mono param-name">
                    {k}
                    {paramHelp(k, base.data?.comments) && (
                      <Help title={k}><span>{paramHelp(k, base.data?.comments)}</span>
                        <span className="faint mono">default in this config: {show(flat[k])}</span></Help>
                    )}
                  </span>
                  {typeof flat[k] === "boolean" ? (
                    <select className="select mono" value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })}>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input className="input mono" value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
                  )}
                </label>
              ))}
            </div>
          </div>

          <label className="check">
            <input type="checkbox" checked={evaluate} onChange={(e) => setEvaluate(e.target.checked)} />
            Evaluate the new version when training ends, then compare it with production.
            <Help title="Evaluation">
              <span>Runs the project evaluate entrypoint on the new version, on the datasets below. They default to the versions production was evaluated on, so both are compared on the same data. The result feeds the promotion rule.</span>
            </Help>
          </label>
          {evaluate && o.datasets.length > 0 && (
            <div className="field">
              <span className="field-label">Evaluate on <span className="faint">· defaults to the versions production was evaluated on, so results are comparable</span></span>
              {o.datasets.map((d) => (
                <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="mono" style={{ flex: 1 }}>{d.name}</span>
                  <select className="select mono" value={evalPicked[d.name] ?? ""}
                    onChange={(e) => setEvalPicked({ ...evalPicked, [d.name]: e.target.value === "" ? "" : Number(e.target.value) })}>
                    <option value="">not mounted</option>
                    {d.versions.map((v) => <option key={v} value={v}>v{v}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
          <ProfilePicker profiles={o.profiles.map((p) => p.name)} picked={bench} onChange={setBench} details={profileDetails} />
          {error && <Note kind="error">{error}</Note>}
        </>
      )}
    </Modal>
  );
}
