import { Info } from "lucide-react";
import { lookup } from "../lib/glossary";

function PrDiagram() {
  return (
    <svg viewBox="0 0 220 74" width="220" height="74" aria-hidden="true" style={{ display: "block", margin: "8px 0 2px" }}>
      <rect x="1" y="1" width="130" height="72" rx="6" fill="none" stroke="var(--border-strong)" />
      <rect x="89" y="1" width="130" height="72" rx="6" fill="color-mix(in srgb, var(--series-1) 10%, transparent)" stroke="var(--series-1)" />
      <text x="40" y="34" className="tip-label" textAnchor="middle">FN</text>
      <text x="40" y="50" className="tip-sub" textAnchor="middle">missed</text>
      <text x="110" y="34" className="tip-label" textAnchor="middle">TP</text>
      <text x="110" y="50" className="tip-sub" textAnchor="middle">found</text>
      <text x="180" y="34" className="tip-label" textAnchor="middle">FP</text>
      <text x="180" y="50" className="tip-sub" textAnchor="middle">false alarm</text>
      <text x="4" y="70" className="tip-sub">real objects</text>
      <text x="216" y="70" className="tip-sub" textAnchor="end">predictions</text>
    </svg>
  );
}

export default function InfoTip({ metric, custom, align = "left" }: {
  metric: string;
  custom?: Record<string, string>;
  align?: "left" | "right";
}) {
  const entry = lookup(metric, custom);
  if (!entry) return null;
  return (
    <span className="tip">
      <button type="button" className="tip-btn" aria-label={`About ${entry.title}`}>
        <Info size={13} strokeWidth={1.8} />
      </button>
      <span role="tooltip" className={`tip-panel ${align}`}>
        <span className="tip-title">{entry.title}</span>
        <span>{entry.what}</span>
        {entry.diagram === "pr" && <PrDiagram />}
        {entry.formula && <span className="tip-formula mono">{entry.formula}</span>}
        {entry.better && <span className="faint">{entry.better === "higher" ? "Higher is better." : "Lower is better."}</span>}
      </span>
    </span>
  );
}
