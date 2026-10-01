import { useEffect, useRef, type ReactNode } from "react";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function Note({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: ReactNode }) {
  return <div className={`note ${kind}`} role={kind === "error" ? "alert" : undefined}>{children}</div>;
}

export function Badge({ tone, dot, children }: { tone?: "success" | "warning" | "danger"; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`badge ${tone ?? ""}`}>
      {dot && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Stat({ label, value, health }: {
  label: ReactNode;
  value: ReactNode;
  health?: { tone: "good" | "warning" | "danger"; note: string };
}) {
  return (
    <div className={`stat ${health?.tone ?? ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {health && <div className="stat-note"><span className="stat-dot" />{health.note}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose}>
      <div className="modal-head">
        <h2 className="title" style={{ fontSize: 26 }}>{title}</h2>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      <div className="modal-body">{children}</div>
      <div className="modal-foot">{footer}</div>
    </dialog>
  );
}

export function Field({ label, hint, help, children, full }: {
  label: string;
  hint?: string;
  help?: ReactNode;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span className="field-label">{label}{help}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
