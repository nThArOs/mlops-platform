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
