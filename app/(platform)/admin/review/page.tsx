import Link from "next/link";
import { container } from "@/composition/root";
import { hasActiveReuseConsent } from "@/services/suppliers";
import { requirePageRole } from "../../_lib/guard";
export const dynamic = "force-dynamic";

export default async function ReviewQueue() {
  const ctx = await requirePageRole("admin");
  const { claims, docsNeedingManual } = await container().platform().review.queue(ctx);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Review queue</h1>
      <p className="text-sm text-muted">Nothing reaches a buyer&apos;s pack until it is accepted here. Every extracted field already passed the verbatim-quote check.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-muted"><tr><th className="py-2">Supplier</th><th>Stage</th><th>Facility</th><th>Country</th><th>Flag</th><th>For</th><th>Reuse</th><th /></tr></thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id} className="border-t border-line">
              <td className="py-2">{c.document.request.supplier.name}</td>
              <td>{c.stage ?? "-"}</td>
              <td>{c.facilityName ?? "-"}</td>
              <td>{c.countryIso ?? c.country ?? "-"}</td>
              <td>{c.coveredCountry ? <span className="text-red-300">covered</span> : ""}</td>
              <td className="text-muted">{c.document.request.pack ? c.document.request.pack.org.name : `Verification: ${c.document.request.verification?.listing.name ?? "supplier"}`}</td>
              <td className="text-muted">{c.document.request.verification || hasActiveReuseConsent(c.document.request) ? "allowed" : "this buyer only"}</td>
              <td><Link className="underline" href={`/admin/review/${c.id}`}>Review</Link></td>
            </tr>
          ))}
          {claims.length === 0 ? <tr><td className="py-3 text-muted" colSpan={8}>No claims waiting.</td></tr> : null}
        </tbody>
      </table>
      <section>
        <h2 className="font-semibold">Documents with no extracted claims (scans / manual entry)</h2>
        <ul className="text-sm">
          {docsNeedingManual.map((d) => (
            <li key={d.id} className="py-1">
              {d.request.supplier.name}: {d.fileName} ({d.rejectionReason ?? "no claims found"}) · <a className="underline" href={`/api/admin/documents/${d.id}/file`} target="_blank">open PDF</a>
              {" · "}add claims via <code className="text-xs">POST /api/admin/documents/{d.id}/claims</code>
            </li>
          ))}
          {docsNeedingManual.length === 0 ? <li className="text-muted">None.</li> : null}
        </ul>
      </section>
    </div>
  );
}
