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

export type ModelSummary = {
  name: string;
  task: string | null;
  primary: string;
  higher_is_better: boolean;
  versions: number;
  production: number | null;
  updated_at: string;
};

export type ModelVersion = {
  version: number;
  status: string;
  aliases: string[];
  run_id: string;
  trained_on: string[];
  evaluations: Record<string, Record<string, number>>;
};

export type ModelEvent = {
  id: number;
  action: string;
  from_version: number | null;
  to_version: number;
  reason: string | null;
  forced: boolean;
  created_at: string;
};

export type ModelDetail = { versions: ModelVersion[]; history: ModelEvent[]; production: number | null };

export type Deployment = {
  project: string;
  running: boolean;
  state?: string;
  version?: number;
  profile?: string;
  started_at?: string;
  port?: number;
  healthy?: boolean;
  servable?: boolean;
  production: number | null;
};

type Points = [number, number][];
type LiveKey = "latency_p50_ms" | "latency_p95_ms" | "requests_per_s" | "error_rate" | "confidence_mean" | "predictions_per_input";
export type LiveMetrics = Partial<Record<LiveKey, Points>> & { stages_ms?: Record<string, Points> };

export const models = {
  info: () => request<{ mlflow_url: string; prometheus_url: string }>("/api/info"),
  list: () => request<ModelSummary[]>("/api/models"),
  get: (project: string) => request<ModelDetail>(`/api/models/${project}`),
  check: (project: string, version: number, dataset?: string) =>
    request<{ allowed: boolean; detail: string }>(
      `/api/models/${project}/versions/${version}/check${dataset ? `?dataset=${encodeURIComponent(dataset)}` : ""}`),
  promote: (project: string, body: { version: number; dataset?: string; force?: boolean; reason?: string }) =>
    request<{ detail: string; deployment: Deployment | null }>(`/api/models/${project}/promote`, json(body)),
  rollback: (project: string, reason?: string) =>
    request<{ version: number; deployment: Deployment | null }>(`/api/models/${project}/rollback`, json({ reason })),
};

export const production = {
  list: () => request<Deployment[]>("/api/production"),
  get: (project: string) => request<Deployment>(`/api/production/${project}`),
  start: (project: string, version?: number) =>
    request<Deployment>(`/api/production/${project}/start`, json({ version })),
  stop: (project: string) => request<Deployment>(`/api/production/${project}/stop`, { method: "POST" }),
  metrics: (project: string, minutes: number) =>
    request<LiveMetrics>(`/api/production/${project}/metrics?minutes=${minutes}`),
  logs: (project: string) => request<{ logs: string }>(`/api/production/${project}/logs`),
};
