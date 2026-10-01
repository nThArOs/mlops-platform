import { useEffect, useState } from "react";
import { File, FileImage, FileText, Folder } from "lucide-react";
import { api } from "../api";
import { bytes, count, files as fileCount, kind } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { Loading, Note } from "./ui";

const TEXT_PREVIEW_BYTES = 64 * 1024;

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
      {type === "image" && <img src={url} alt={path} />}
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
