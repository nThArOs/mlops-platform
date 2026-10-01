import { useState } from "react";
import { Plus, X } from "lucide-react";
import { api, type AddResult } from "../api";
import { Field, Modal, Note } from "./ui";

type Mode = "folder" | "upload";
type SplitRow = { name: string; path: string };

export default function AddDatasetDialog({ open, onClose, onAdded, dataset }: {
  open: boolean;
  onClose: () => void;
  onAdded: (result: AddResult) => void;
  dataset?: { name: string; splits: Record<string, string> };
}) {
  const isNewVersion = Boolean(dataset);
  const [mode, setMode] = useState<Mode>("folder");
  const [name, setName] = useState(dataset?.name ?? "");
  const [folder, setFolder] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [license, setLicense] = useState("");
  const [source, setSource] = useState("");
  const [format, setFormat] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [copy, setCopy] = useState(false);
  const [splits, setSplits] = useState<SplitRow[]>(
    dataset ? Object.entries(dataset.splits).map(([n, p]) => ({ name: n, path: p })) : [
      { name: "train", path: "train" },
      { name: "test", path: "test" },
    ],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): string | null {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return "Use lowercase letters, digits, - and _ for the name.";
    if (!isNewVersion && !license.trim()) return "Enter a license, for example CC0-1.0 or research-only.";
    if (mode === "folder" && !folder.trim()) return "Enter the folder path on this machine.";
    if (mode === "upload" && !file) return "Choose a .zip file.";
    if (mode === "upload" && file && !file.name.toLowerCase().endsWith(".zip")) return "The file must be a .zip archive.";
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const form = {
      name,
      license: license.trim() || undefined,
      source: source.trim() || undefined,
      format: format.trim() || undefined,
      description: description.trim() || undefined,
      note: note.trim() || undefined,
      splits: Object.fromEntries(splits.filter((s) => s.name && s.path).map((s) => [s.name, s.path])),
    };
    try {
      const result = mode === "folder"
        ? await api.addFolder({ ...form, folder: folder.trim(), copy_files: copy })
        : await api.upload(form, file!);
      onAdded(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const setSplit = (i: number, patch: Partial<SplitRow>) =>
    setSplits(splits.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNewVersion ? `New version of ${dataset!.name}` : "Add a dataset"}
      subtitle="Files are stored once by content; unchanged files cost no extra space."
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} aria-busy={busy}>
            {busy ? "Adding…" : isNewVersion ? "Create version" : "Add dataset"}
          </button>
        </>
      }
    >
      <div className="segmented" role="tablist">
        <button className={mode === "folder" ? "on" : ""} onClick={() => setMode("folder")}>From a folder</button>
        <button className={mode === "upload" ? "on" : ""} onClick={() => setMode("upload")}>Upload a zip</button>
      </div>

      <div className="form-grid">
        {!isNewVersion && (
          <Field label="Name">
            <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="dut_anti_uav" />
          </Field>
        )}
        {!isNewVersion && (
          <Field label="License">
            <input className="input" value={license} onChange={(e) => setLicense(e.target.value)} placeholder="Apache-2.0" />
          </Field>
        )}
        {mode === "folder" ? (
          <Field label="Folder" hint="Absolute path on the machine running the platform." full>
            <input className="input mono" value={folder} onChange={(e) => setFolder(e.target.value)}
              placeholder="C:\data\dut_anti_uav" />
          </Field>
        ) : (
          <Field label="Archive" hint="Up to 2 GB. For larger datasets, add the folder instead." full>
            <input className="input" type="file" accept=".zip" style={{ paddingTop: 6 }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        )}
        {!isNewVersion && (
          <>
            <Field label="Source">
              <input className="input" value={source} onChange={(e) => setSource(e.target.value)}
                placeholder="https://github.com/wangdongdut/DUT-Anti-UAV" />
            </Field>
            <Field label="Format">
              <input className="input" value={format} onChange={(e) => setFormat(e.target.value)} placeholder="mot" />
            </Field>
            <Field label="Description" full>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Drone videos with one annotated target per frame" />
            </Field>
          </>
        )}
        <Field label="Version note" full>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Relabeled night sequences" />
        </Field>
      </div>

      <div className="field">
        <span className="field-label">Splits, as name and subfolder</span>
        {splits.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 8 }}>
            <input className="input mono" style={{ flex: 1 }} value={s.name} aria-label="Split name"
              onChange={(e) => setSplit(i, { name: e.target.value })} />
            <input className="input mono" style={{ flex: 2 }} value={s.path} aria-label="Split subfolder"
              onChange={(e) => setSplit(i, { path: e.target.value })} />
            <button className="btn ghost icon-btn" aria-label="Remove split"
              onClick={() => setSplits(splits.filter((_, j) => j !== i))}><X size={14} /></button>
          </div>
        ))}
        <div>
          <button className="btn ghost small" onClick={() => setSplits([...splits, { name: "", path: "" }])}>
            <Plus size={14} /> Add split
          </button>
        </div>
      </div>

      {mode === "folder" && (
        <label className="check">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          Copy files instead of linking them. Linked source files become read-only.
        </label>
      )}
      {error && <Note kind="error">{error}</Note>}
    </Modal>
  );
}
