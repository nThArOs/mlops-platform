export type Entry = { title: string; what: string; formula?: string; better?: "higher" | "lower"; diagram?: "pr" };

const G: Record<string, Entry> = {
  hota: {
    title: "HOTA",
    what: "Overall tracking quality: balances finding the objects (detection) and keeping the same identity on each object over time (association).",
    formula: "HOTA = √(DetA × AssA), averaged over IoU thresholds 0.05 to 0.95",
    better: "higher",
  },
  deta: { title: "DetA", what: "Detection part of HOTA: how well boxes match the ground truth, ignoring identities.", formula: "DetA = TP / (TP + FN + FP)", better: "higher" },
  assa: { title: "AssA", what: "Association part of HOTA: how consistently each object keeps one track identity.", better: "higher" },
  mota: {
    title: "MOTA",
    what: "Classic tracking accuracy. Counts every miss, false alarm and identity switch against the number of annotated objects. Can go below zero when false alarms outnumber objects.",
    formula: "MOTA = 1 − (FN + FP + IDSW) / GT",
    better: "higher",
  },
  idf1: { title: "IDF1", what: "Share of detections that carry the correct identity, over the whole video.", formula: "IDF1 = 2·IDTP / (2·IDTP + IDFP + IDFN)", better: "higher" },
  idsw: { title: "ID switches", what: "Number of times a tracked object changes identity.", better: "lower" },
  fp: { title: "False positives", what: "Predicted objects that don't exist in the ground truth: false alarms.", better: "lower", diagram: "pr" },
  fn: { title: "False negatives", what: "Annotated objects the model missed.", better: "lower", diagram: "pr" },
  gt: { title: "Ground truth", what: "Number of annotated objects in the evaluation set." },
  precision: {
    title: "Precision",
    what: "When the model says “drone”, how often it's right. Low precision means false alarms.",
    formula: "Precision = TP / (TP + FP)",
    better: "higher",
    diagram: "pr",
  },
  recall: {
    title: "Recall",
    what: "Of all the real objects, how many the model found. Low recall means missed objects.",
    formula: "Recall = TP / (TP + FN)",
    better: "higher",
    diagram: "pr",
  },
  f1: {
    title: "F1 score",
    what: "Single score that is high only when both precision and recall are high: the harmonic mean of the two.",
    formula: "F1 = 2·P·R / (P + R) = 2·TP / (2·TP + FP + FN)",
    better: "higher",
    diagram: "pr",
  },
  map50: { title: "mAP@50", what: "Mean average precision when a box counts as correct if it overlaps the truth by at least 50 % (IoU ≥ 0.5).", better: "higher" },
  map50_95: { title: "mAP@50:95", what: "Same as mAP@50 but averaged over stricter overlaps, from 50 % to 95 %. Rewards precise boxes.", better: "higher" },
  rmse: { title: "RMSE", what: "Typical size of the prediction error, in the unit of the target.", formula: "RMSE = √(mean((ŷ − y)²))", better: "lower" },
  r2: { title: "R²", what: "Share of the target's variation the model explains. 1 is perfect, 0 is no better than predicting the mean.", formula: "R² = 1 − Σ(ŷ − y)² / Σ(y − ȳ)²", better: "higher" },
  fps: { title: "Frames per second", what: "How many frames the pipeline processes per second, decoding and inference included.", better: "higher" },
  latency: {
    title: "Latency p50 / p95",
    what: "Time to run the model on one input. p50 is the typical case; p95 is the slow case, exceeded by only 5 % of requests. Embedded targets are sized on p95.",
    better: "lower",
  },
  throughput: { title: "Throughput", what: "Requests or frames handled per second by the service, averaged over the last minute.", better: "higher" },
  error_rate: { title: "Error rate", what: "Share of requests that failed over the last minute.", formula: "errors / requests", better: "lower" },
  predictions_per_input: { title: "Predictions per input", what: "Average number of objects predicted per frame or request. A sudden change often means the input data changed." },
  confidence: { title: "Mean confidence", what: "Average score the model gives to its predictions. A slow drop over days is a common sign of data drift." },
  stages: { title: "Time per stage", what: "Average time spent per frame in each step of the pipeline. Shows what to optimize first for an embedded target." },
  confusion: {
    title: "Confusion matrix",
    what: "Rows are what was really there, columns what the model predicted. The diagonal is correct; the background row holds false alarms and the background column holds misses.",
  },
};

const ALIASES: Record<string, string> = {
  "map50-95": "map50_95", map: "map50_95", "latency_p50_ms": "latency", "latency_p95_ms": "latency",
  requests_per_s: "throughput", confidence_mean: "confidence", ids: "idsw",
};

export function lookup(metric: string, custom?: Record<string, string>): Entry | null {
  if (custom?.[metric]) return { title: metric, what: custom[metric] };
  const last = metric.split(".").pop()!.toLowerCase();
  const key = ALIASES[last] ?? last;
  return G[key] ?? null;
}
