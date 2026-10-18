import { CONFLICT_DISCLOSURE } from "@/services/pricing";

/** How Lodeline is paid. Shown wherever a buyer reads findings or pays (see docs/business-model.md). */
export function ConflictDisclosure({ className = "" }: { className?: string }) {
  return <p className={`text-xs leading-relaxed text-muted ${className}`}>{CONFLICT_DISCLOSURE}</p>;
}
