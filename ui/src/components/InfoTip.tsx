import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { lookup } from "../lib/glossary";

const WIDTH = 280;
const GAP = 8;

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

/** Info icon whose panel floats above the page, so opening it never moves the layout. */
export function Help({ title, children }: { title: string; children: ReactNode; align?: "left" | "right" }) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 0;
    const left = Math.min(Math.max(8, r.left - 12), window.innerWidth - WIDTH - 8);
    const below = r.bottom + GAP;
    const top = below + height > window.innerHeight - 8 && r.top - GAP - height > 8 ? r.top - GAP - height : below;
    setPos({ left, top });
  }, [open]);

  const host = button.current?.closest("dialog") ?? document.body;
  return (
    <span className="tip" onClick={(e) => e.preventDefault()}>
      <button ref={button} type="button" className="tip-btn" aria-label={`About ${title}`} aria-expanded={open}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
        <Info size={13} strokeWidth={1.8} />
      </button>
      {open && createPortal(
        <span ref={panel} role="tooltip" className="tip-panel tip-floating"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: WIDTH }}>
          <span className="tip-title">{title}</span>
          {children}
        </span>,
        host,
      )}
    </span>
  );
}

export default function InfoTip({ metric, custom }: {
  metric: string;
  custom?: Record<string, string>;
  align?: "left" | "right";
}) {
  const entry = lookup(metric, custom);
  if (!entry) return null;
  return (
    <Help title={entry.title}>
      <span>{entry.what}</span>
      {entry.diagram === "pr" && <PrDiagram />}
      {entry.formula && <span className="tip-formula mono">{entry.formula}</span>}
      {entry.better && <span className="faint">{entry.better === "higher" ? "Higher is better." : "Lower is better."}</span>}
    </Help>
  );
}
