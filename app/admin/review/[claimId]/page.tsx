import { notFound } from "next/navigation";
import { container } from "@/composition/root";
import { isDomainError } from "@/domain/errors";
import { requirePageRole } from "../../../_lib/guard";
import { DecideForm } from "./decide";
export const dynamic = "force-dynamic";

function highlight(text: string, quotes: string[]) {
  const norm = text.replace(/\s+/g, " ");
  const marks: [number, number][] = [];
  for (const q of quotes) {
    const i = norm.indexOf(q);
    if (i >= 0) marks.push([i, i + q.length]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out: React.ReactNode[] = [];
  let pos = 0;
  marks.forEach(([a, b], k) => {
    if (a < pos) return;
    out.push(norm.slice(pos, a), <mark key={k} className="bg-accent/40 text-paper">{norm.slice(a, b)}</mark>);
    pos = b;
  });
  out.push(norm.slice(pos));
  return out;
}

export default async function ReviewClaim({ params }: { params: Promise<{ claimId: string }> }) {
  const ctx = await requirePageRole("admin");
  const { claimId } = await params;
  let claim;
  try {
    claim = await container().platform().review.claimWithPages(ctx, claimId);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const citations = (claim.citations as { field: string; page: number; quote: string }[]) ?? [];
  const pagesCited = [...new Set(citations.map((c) => c.page))].sort((a, b) => a - b);
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Source: {claim.document.fileName}</h1>
        <p className="text-xs text-muted">Supplier {claim.document.request.supplier.name} · sha256 {claim.document.sha256.slice(0, 16)}… · {claim.document.pageCount} page(s)</p>
        {pagesCited.map((p) => {
          const page = claim.document.pages.find((x) => x.page === p);
          return (
            <div key={p} className="rounded border border-line bg-ink-2 p-3 space-y-1">
              <div className="flex justify-between text-xs text-muted"><span>Page {p} (extracted text)</span><a className="underline" target="_blank" href={`/api/admin/documents/${claim.documentId}/file?page=${p}`}>open PDF page</a></div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{page ? highlight(page.text, citations.filter((c) => c.page === p).map((c) => c.quote)) : "(page text missing)"}</p>
            </div>
          );
        })}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Claim</h2>
        <ul className="text-xs text-muted space-y-1">{citations.map((c, i) => <li key={i}>{c.field} · p.{c.page}: &ldquo;{c.quote}&rdquo;</li>)}</ul>
        <p className="text-sm">
          Geocode: {claim.latitude != null ? `${claim.latitude.toFixed(4)}, ${claim.longitude?.toFixed(4)} (${claim.geocodeProvider})` : "not geocoded"} · Country {claim.countryIso ?? "-"}
          {claim.coveredCountry ? <span className="text-red-300"> · COVERED: {claim.coveredReason}</span> : claim.coveredReason ? <span className="text-muted"> · {claim.coveredReason}</span> : null}
        </p>
        <DecideForm
          claimId={claim.id}
          initial={{ issuer: claim.issuer ?? "", issueDate: claim.issueDate?.toISOString().slice(0, 10) ?? "", stage: claim.stage ?? "", facilityName: claim.facilityName ?? "", address: claim.address ?? "", country: claim.country ?? "" }}
        />
      </section>
    </div>
  );
}
