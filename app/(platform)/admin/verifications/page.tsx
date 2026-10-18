import { container } from "@/composition/root";
import { usd } from "@/services/pricing";
import { requirePageRole } from "../../_lib/guard";
import { ActionButton } from "../../_components/action-button";
import { StartVerificationForm } from "./start-form";
export const dynamic = "force-dynamic";

/**
 * Supplier verifications (supplier pays a flat annual fee for a review of its
 * own evidence). Marking a listing verified is a separate step on the
 * Suppliers page and depends only on accepted evidence.
 */
export default async function AdminVerifications() {
  const ctx = await requirePageRole("admin");
  const p = container().platform();
  const rows = await p.verifications.list(ctx);
  const listings = await p.deps.db.supplierListing.findMany({
    where: { isExample: false },
    orderBy: { name: "asc" },
    include: { application: { select: { email: true, contactName: true } } },
  });
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Supplier verifications</h1>
        <p className="text-sm text-muted">
          The supplier pays for the review, not for the result. The fee is the same whatever the documents show. A listing is marked verified only on the
          Suppliers page, from accepted evidence. Close each paid verification as complete once the review is done, whatever it found.
        </p>
      </header>
      <StartVerificationForm listings={listings.map((l) => ({ id: l.id, name: l.name, email: l.application?.email ?? null, contact: l.application?.contactName ?? null }))} />
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr><th className="py-2">Listing</th><th>Fee</th><th>Status</th><th>Paid</th><th>Year ends</th><th>Documents</th><th>Listing verified</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const docs = v.requests.flatMap((r) => r.documents);
            return (
              <tr key={v.id} className="border-t border-line align-top">
                <td className="py-2">{v.listing.name}<div className="text-xs text-muted">{v.contactEmail} · {v.facilities} facilit{v.facilities === 1 ? "y" : "ies"}</div></td>
                <td>{usd(v.priceCents)}</td>
                <td>{v.status.replace("_", " ")}</td>
                <td>{v.paidAt ? v.paidAt.toISOString().slice(0, 10) : "-"}</td>
                <td>{v.periodEndsAt ? v.periodEndsAt.toISOString().slice(0, 10) : "-"}</td>
                <td>{docs.length ? `${docs.filter((d) => d.status === "accepted").length} accepted of ${docs.length}` : "-"}</td>
                <td>{v.listing.verifiedAt ? v.listing.verifiedAt.toISOString().slice(0, 10) : "no"}</td>
                <td className="space-x-2">
                  {v.status === "pending_payment" && v.checkoutUrl ? <a className="text-xs underline" href={v.checkoutUrl} target="_blank">payment link</a> : null}
                  {v.status === "pending_payment" ? <ActionButton url={`/api/admin/verifications/${v.id}`} body={{ action: "cancel" }} label="Cancel" confirm="Cancel this unpaid verification?" className="text-xs underline" /> : null}
                  {v.status === "collecting" ? <ActionButton url={`/api/admin/verifications/${v.id}`} body={{ action: "complete" }} label="Mark review complete" confirm="Close this verification? Do this once the review is done, whatever it found." className="text-xs underline" /> : null}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? <tr><td colSpan={8} className="py-3 text-muted">No verifications yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
