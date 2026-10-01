export type Tone = "good" | "warning" | "danger";
export type Health = { tone: Tone; note: string };

// Share of a limit: comfortable below 70 %, tight up to 90 %, critical above.
export function ofLimit(value: number, limit: number, unit: string): Health {
  const share = value / limit;
  const tone: Tone = share < 0.7 ? "good" : share < 0.9 ? "warning" : "danger";
  return { tone, note: `${Math.round(share * 100)} % of ${limit} ${unit}` };
}

export function latency(p95: number, limit?: number): Health | undefined {
  if (!limit) return undefined;
  const h = ofLimit(p95, limit, "ms");
  return { ...h, tone: p95 > limit ? "danger" : h.tone };
}

export function memory(mb: number, limitMb: number): Health | undefined {
  return limitMb < 15000 ? ofLimit(mb, limitMb, "MB") : undefined;
}

// A busy CPU is normal for a stream; only a saturated one is worth a look.
export function cpu(cores: number, limit?: number): Health | undefined {
  if (!limit) return undefined;
  const share = cores / limit;
  return { tone: share < 0.95 ? "good" : "warning", note: `${Math.round(share * 100)} % of ${limit} CPU` };
}

export function errors(rate: number): Health {
  if (rate === 0) return { tone: "good", note: "no errors" };
  return { tone: rate < 0.01 ? "warning" : "danger", note: rate < 0.01 ? "a few errors" : "frequent errors" };
}

export function throughput(fps: number, min?: number): Health | undefined {
  if (!min) return undefined;
  return { tone: fps >= min ? "good" : fps >= 0.8 * min ? "warning" : "danger", note: `target ${min} fps` };
}

// Signed relative gain of a metric over a reference, positive when better.
export function gain(value: number, ref: number, better: "higher" | "lower" = "higher"): number {
  const g = (value - ref) / Math.max(Math.abs(ref), 1e-9);
  return better === "higher" ? g : -g;
}

export const TOLERANCE = 0.02;

export function versus(value: number, ref: number, better: "higher" | "lower" = "higher"): Tone | undefined {
  const g = gain(value, ref, better);
  return g > TOLERANCE ? "good" : g < -TOLERANCE ? "danger" : undefined;
}

// How far a metric is from the best version: the best or close to it is fine, then tight, then behind.
export function againstBest(value: number, best: number, version: number | undefined, better: "higher" | "lower" = "higher"): Health {
  const g = gain(value, best, better);
  if (g >= -TOLERANCE) return { tone: "good", note: "best of the versions" };
  return { tone: g >= -0.1 ? "warning" : "danger", note: `v${version} is ${Math.round(-g * 100)} % better` };
}
