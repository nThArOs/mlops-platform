export type Split = { path: string; files: number };

export type DatasetSummary = {
  name: string;
  license: string;
  format: string | null;
  version: number;
  versions: number;
  files: number;
  bytes: number;
  created_at: string;
};

export type DatasetVersion = {
  id: number;
  version: number;
  parent_id: number | null;
  manifest_hash: string;
  files: number;
  bytes: number;
  splits: Record<string, Split>;
  note: string | null;
  archived: boolean;
  created_at: string;
  runs: number;
  in_production: boolean;
};

export type Dataset = {
  id: number;
  name: string;
  license: string;
  source: string | null;
  format: string | null;
  description: string | null;
  created_at: string;
  versions: DatasetVersion[];
};

export type Usage = { run_id: string; project: string; entrypoint: string; mount: string; created_at: string };

export type VersionDetail = DatasetVersion & { name: string; usage: Usage[] };

export type Listing = {
  prefix: string;
  dirs: { name: string; files: number }[];
  files: { path: string; name: string; size: number }[];
  total_files: number;
};

export type Diff = { added: string[]; removed: string[]; modified: string[] };

export type AddResult = { name: string; version: number; unchanged: boolean; files?: number; linked?: number; copied?: number };

export type DatasetForm = {
  name: string;
  license?: string;
  source?: string;
  format?: string;
  description?: string;
  note?: string;
  splits: Record<string, string>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep status text */
    }
    throw new Error(detail);
  }
  return res.json();
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const clean = (form: DatasetForm) =>
  Object.fromEntries(Object.entries(form).filter(([, v]) => v !== "" && v !== undefined));

export const api = {
  datasets: () => request<DatasetSummary[]>("/api/datasets"),
  dataset: (name: string) => request<Dataset>(`/api/datasets/${name}`),
  version: (name: string, v: number) => request<VersionDetail>(`/api/datasets/${name}/versions/${v}`),
  browse: (name: string, v: number, prefix: string) =>
    request<Listing>(`/api/datasets/${name}/versions/${v}/browse?prefix=${encodeURIComponent(prefix)}`),
  fileUrl: (name: string, v: number, path: string) =>
    `/api/datasets/${name}/versions/${v}/file?path=${encodeURIComponent(path)}`,
  diff: (name: string, a: number, b: number) => request<Diff>(`/api/datasets/${name}/diff?a=${a}&b=${b}`),
  archive: (name: string, v: number) =>
    request<{ archived: boolean }>(`/api/datasets/${name}/versions/${v}/archive`, { method: "POST" }),
  addFolder: (form: DatasetForm & { folder: string; copy_files: boolean }) =>
    request<AddResult>("/api/datasets", json(clean(form))),
  upload: (form: DatasetForm, file: File) => {
    const data = new FormData();
    data.append("file", file);
    for (const [k, v] of Object.entries(clean(form))) {
      if (k === "splits") {
        const s = Object.entries(form.splits).map(([n, p]) => `${n}=${p}`).join(",");
        if (s) data.append("splits", s);
      } else data.append(k, String(v));
    }
    return request<AddResult>("/api/datasets/upload", { method: "POST", body: data });
  },
};
