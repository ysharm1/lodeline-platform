import { listingStatusLabel, type StatusInput } from "@/services/marketplace";

export function StatusBadge({ listing }: { listing: StatusInput }) {
  const s = listingStatusLabel(listing);
  const cls = s.tone === "ok" ? "border-ok/60 text-ok" : s.tone === "accent" ? "border-accent/60 text-accent" : "border-line text-muted";
  return <span className={`rounded border px-1.5 text-xs ${cls}`} data-testid="listing-status">{s.label}</span>;
}
