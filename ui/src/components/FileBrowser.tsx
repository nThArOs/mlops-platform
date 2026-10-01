import { useEffect, useState } from "react";
import { File, FileImage, FileText, Folder } from "lucide-react";
import { api } from "../api";
import { bytes, count, files as fileCount, kind } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { Loading, Note } from "./ui";

const TEXT_PREVIEW_BYTES = 64 * 1024;

type Box = { cls: number; cx: number; cy: number; w: number; h: number };

function labelPath(path: string): string | null {
  const i = path.lastIndexOf("/images/");
  if (i < 0) return null;
  return `${path.slice(0, i)}/labels/${path.slice(i + 8).replace(/\.[^./]+$/, ".txt")}`;
}

function AnnotatedImage({ name, version, path }: { name: string; version: number; path: string }) {
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const labels = labelPath(path);

  useEffect(() => {
    setBoxes(null);
    if (!labels) return;
    fetch(api.fileUrl(name, version, labels))
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => setBoxes(t.split(/\r?\n/).map((l) => l.trim().split(/\s+/).map(Number))
        .filter((v) => v.length >= 5 && v.every((x) => !Number.isNaN(x)))
        .map(([cls, cx, cy, w, h]) => ({ cls, cx, cy, w, h }))))
      .catch(() => setBoxes(null));
  }, [name, version, labels]);

  return (
    <>
      <div style={{ position: "relative" }}>
        <img src={api.fileUrl(name, version, path)} alt={path} />
        {boxes && (
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            {boxes.map((b, i) => (
              <rect key={i} x={b.cx - b.w / 2} y={b.cy - b.h / 2} width={b.w} height={b.h}
                fill="none" stroke="var(--series-2)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
      </div>
      {boxes && (
        <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>
          {boxes.length} {boxes.length === 1 ? "box" : "boxes"} from <span className="mono">{labels}</span>
        </div>
      )}
    </>
  );
}

function Preview({ name, version, path }: { name: string; version: number; path: string }) {
  const url = api.fileUrl(name, version, path);
  const type = kind(path);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    setError(null);
    if (type !== "text") return;
    fetch(url, { headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
      .then((t) => setText(t.split(/\r?\n/).slice(0, 200).join("\n")))
      .catch((e: Error) => setError(e.message));
  }, [url, type]);

  return (
    <div className="preview">
      <div className="mono muted" style={{ marginBottom: 10, wordBreak: "break-all" }}>{path}</div>
      {type === "image" && <AnnotatedImage name={name} version={version} path={path} />}
      {type === "text" && text === null && !error && <Loading label="Reading" />}
      {type === "text" && text !== null && <pre>{text}</pre>}
      {error && <Note kind="error">Couldn't read the file. {error}</Note>}
      {type === "other" && (
        <p className="muted">No preview for this file type. <a href={url} style={{ textDecoration: "underline" }}>Download it</a>.</p>
      )}
    </div>
  );
}

export default function FileBrowser({ name, version }: { name: string; version: number }) {
  const [prefix, setPrefix] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, loading } = useFetch(() => api.browse(name, version, prefix), [name, version, prefix]);

  useEffect(() => {
    setPrefix("");
    setSelected(null);
  }, [name, version]);

  const parts = prefix ? prefix.split("/") : [];
  const icon = (path: string) => {
    const k = kind(path);
    const Icon = k === "image" ? FileImage : k === "text" ? FileText : File;
    return <Icon size={15} strokeWidth={1.6} className="faint" aria-hidden="true" />;
  };

  return (
    <div className="browser">
      <div className="panel" style={{ overflow: "hidden" }}>
        <div className="crumbs" style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <button onClick={() => setPrefix("")}>{name}@v{version}</button>
          {parts.map((p, i) => (
            <span key={i} style={{ display: "contents" }}>
              <span>/</span>
              <button onClick={() => setPrefix(parts.slice(0, i + 1).join("/"))}>{p}</button>
            </span>
          ))}
        </div>
        <div className="file-list">
          {loading && !data && <div style={{ padding: "0 12px" }}><Loading /></div>}
          {error && <div style={{ padding: 12 }}><Note kind="error">{error}</Note></div>}
          {data?.dirs.map((d) => (
            <div key={d.name} className="file-row" onClick={() => setPrefix(prefix ? `${prefix}/${d.name}` : d.name)}>
              <Folder size={15} strokeWidth={1.6} className="faint" aria-hidden="true" />
              <span>{d.name}</span>
              <span className="size mono faint">{fileCount(d.files)}</span>
            </div>
          ))}
          {data?.files.map((f) => (
            <div key={f.path} className={`file-row ${selected === f.path ? "on" : ""}`} onClick={() => setSelected(f.path)}>
              {icon(f.path)}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <span className="size mono faint">{bytes(f.size)}</span>
            </div>
          ))}
          {data && data.total_files > data.files.length && (
            <div className="faint" style={{ padding: "8px 12px", fontSize: 12.5 }}>
              Showing {data.files.length} of {count(data.total_files)} files.
            </div>
          )}
        </div>
      </div>
      <div className="panel">
        {selected ? <Preview name={name} version={version} path={selected} /> : (
          <div className="preview muted">Select a file to preview it. Images and text files are shown here.</div>
        )}
      </div>
    </div>
  );
}
