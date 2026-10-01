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
  project: string;
  slot: string | null;
  description: string | null;
  task: string | null;
  primary: string;
  higher_is_better: boolean;
  watch: string[];
  descriptions: Record<string, string>;
  constraints: Record<string, Record<string, number>>;
  retrain: { datasets?: string[]; config?: string; promote?: string; benchmark_profiles?: string[] }[];
  versions: number;
  production: number | null;
  updated_at: string;
};

export type ModelVersion = {
  version: number;
  status: string;
  variant: string | null;
  parent: string | null;
  description: string | null;
  aliases: string[];
  run_id: string;
  trained_on: string[];
  evaluations: Record<string, Record<string, number>>;
  confusion: Record<string, { labels: string[]; matrix: (number | null)[][]; rows?: string; columns?: string }>;
  extras: Record<string, Extras>;
  benchmarks: Record<string, Record<string, number | boolean | string>>;
};

export type Extras = {
  curves?: Record<string, Record<string, number[]>>;
  slices?: Record<string, Record<string, number | null> | number[]>;
  intervals?: Record<string, [number, number]>;
};

export type PromotionCheck = {
  allowed: boolean;
  detail: string;
  checks: { metric: string; new: number | null; current: number | null; ok: boolean; rule: string }[];
  dataset?: string;
  current?: number;
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
  resources?: { cpu_pct: number; mem_mb: number; mem_limit_mb: number } | null;
};

export type Alert = { project: string; level: "warning" | "critical"; title: string; detail: string };

type Points = [number, number][];
type LiveKey = "latency_p50_ms" | "latency_p95_ms" | "requests_per_s" | "error_rate" | "confidence_mean" | "predictions_per_input";
export type LiveMetrics = Partial<Record<LiveKey, Points>> & { stages_ms?: Record<string, Points> };

export const models = {
  info: () => request<{ mlflow_url: string; prometheus_url: string }>("/api/info"),
  list: () => request<ModelSummary[]>("/api/models"),
  get: (project: string) => request<ModelDetail>(`/api/models/${project}`),
  check: (project: string, version: number, dataset?: string) =>
    request<PromotionCheck>(
      `/api/models/${project}/versions/${version}/check${dataset ? `?dataset=${encodeURIComponent(dataset)}` : ""}`),
  promote: (project: string, body: { version: number; dataset?: string; force?: boolean; reason?: string }) =>
    request<{ detail: string; deployment: Deployment | null }>(`/api/models/${project}/promote`, json(body)),
  rollback: (project: string, reason?: string) =>
    request<{ version: number; deployment: Deployment | null }>(`/api/models/${project}/rollback`, json({ reason })),
};

export const production = {
  list: () => request<Deployment[]>("/api/production"),
  alerts: () => request<Alert[]>("/api/alerts"),
  get: (project: string) => request<Deployment>(`/api/production/${project}`),
  start: (project: string, version?: number) =>
    request<Deployment>(`/api/production/${project}/start`, json({ version })),
  stop: (project: string) => request<Deployment>(`/api/production/${project}/stop`, { method: "POST" }),
  metrics: (project: string, minutes: number) =>
    request<LiveMetrics>(`/api/production/${project}/metrics?minutes=${minutes}`),
  logs: (project: string) => request<{ logs: string }>(`/api/production/${project}/logs`),
  drift: (project: string) => request<{ ready: boolean; detail?: string; window_minutes: number; features: unknown[]; no_data: string[] }>(`/api/production/${project}/drift`),
  frameUrl: (project: string, view: "input" | "source", t: number) =>
    `/api/production/${project}/frame?view=${view}&width=960&t=${t}`,
};

export type JobProgress = {
  fraction: number | null;
  label: string;
  phase?: string;
  epoch?: number;
  epochs?: number;
  elapsed_s: number | null;
  remaining_s: number | null;
};

export type QueueState = {
  running: Job[];
  queued: (Job & { estimate_s: number | null; starts_at: number | null; ends_at: number | null })[];
  now: number;
};

export type JobStatus = "queued" | "running" | "cancelling" | "finished" | "failed" | "cancelled";

export type Job = {
  id: number;
  project: string;
  model: string;
  entrypoint: string;
  spec: {
    config?: string | null;
    params?: Record<string, unknown>;
    datasets?: string[];
    profile?: string | null;
    variant?: string | null;
    model?: string | null;
    auto_evaluate?: boolean;
    eval_datasets?: string[];
    benchmark_profiles?: string[];
    auto_promote?: boolean;
    note?: string | null;
  };
  status: JobStatus;
  run_id: string | null;
  result: {
    run_id?: string;
    registered?: { model: string; version: number };
    evaluated?: boolean;
    auto_promotion?: { promoted: boolean; detail: string; redeployed?: boolean };
  } | null;
  error: string | null;
  parent_id: number | null;
  children?: number[];
  progress?: JobProgress | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type ProjectOptions = {
  project: string;
  models: { slot: string | null; key: string; description: string | null }[];
  entrypoints: Record<string, { config: string | null }>;
  datasets: { name: string; mount: string; versions: number[] }[];
  configs: string[];
  profiles: { name: string; cpus?: number; memory?: string }[];
  default_profile: string;
};

export type JobRequest = {
  project: string;
  slot?: string | null;
  entrypoint: string;
  config?: string | null;
  params?: Record<string, unknown>;
  datasets: string[];
  profile?: string;
  variant?: string;
  model?: string;
  auto_evaluate?: boolean;
  eval_datasets?: string[];
  values?: Record<string, string>;
  benchmark_profiles?: string[];
  note?: string;
};

export const jobs = {
  options: (project: string) => request<ProjectOptions>(`/api/projects/${project}/options`),
  config: (project: string, path: string) =>
    request<Record<string, unknown>>(`/api/projects/${project}/config?path=${encodeURIComponent(path)}`),
  create: (body: JobRequest) => request<Job>("/api/jobs", json(body)),
  list: (model?: string) => request<Job[]>(`/api/jobs${model ? `?model=${encodeURIComponent(model)}` : ""}`),
  queue: () => request<QueueState>("/api/queue"),
  get: (id: number) => request<Job>(`/api/jobs/${id}`),
  log: (id: number, offset: number) => request<{ text: string; offset: number }>(`/api/jobs/${id}/log?offset=${offset}`),
  cancel: (id: number) => request<Job>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  curves: (runId: string) => request<Record<string, [number, number][]>>(`/api/runs/${runId}/metrics`),
};
