import type { CellStatus } from "@/services/pack-matrix";

export const STATUS_STYLE: Record<CellStatus, { label: string; cls: string; color: string }> = {
  documented: { label: "Documented", cls: "border-ok/60 text-ok", color: "#6fa37f" },
  covered_country: { label: "Covered country", cls: "border-red-400/70 text-red-300", color: "#e05252" },
  in_review: { label: "Pending review", cls: "border-accent/60 text-accent", color: "#c9a24a" },
  requested: { label: "Requested", cls: "border-line text-muted", color: "#8a97ab" },
  no_document: { label: "No document", cls: "border-gap/60 text-gap", color: "#d9734e" },
};

export function StatusPill({ status, children }: { status: CellStatus; children?: React.ReactNode }) {
  const s = STATUS_STYLE[status];
  return <span className={`inline-block rounded border px-2 py-0.5 text-xs ${s.cls}`}>{children ?? s.label}</span>;
}
