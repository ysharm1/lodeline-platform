import Link from "next/link";
import { container } from "@/composition/root";
import { requirePageRole } from "../../_lib/guard";
import { ActionButton } from "../../_components/action-button";
export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" }) + " MST";

/** Admin queue: "For suppliers" applications. Approve -> unpublished, unverified listing. */
export default async function AdminApplications() {
  const ctx = await requirePageRole("admin");
  const apps = await container().platform().applications.list(ctx);
  const pending = apps.filter((a) => a.status === "pending");
  const decided = apps.filter((a) => a.status !== "pending");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Supplier applications</h1>
      <p className="text-sm text-muted">Approving creates an unpublished, unverified directory listing. Verify it from accepted evidence documents and publish it under Suppliers.</p>
      <section className="space-y-3">
        <h2 className="font-semibold">Pending ({pending.length})</h2>
        {pending.length === 0 ? <p className="text-sm text-muted">Nothing waiting.</p> : null}
        {pending.map((a) => (
          <article key={a.id} className="rounded border border-line bg-ink-2 p-4 space-y-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="font-medium">{a.companyName}</h3>
              <span className="text-xs text-muted">{a.countryIso ?? "country not given"} · {a.stages.join(", ")} · {a.materials.join(", ")} · {fmt(a.createdAt)}</span>
            </div>
            <p className="text-sm">{a.summary}</p>
            {a.documentsNote ? <p className="text-sm text-muted">Documents: {a.documentsNote}</p> : null}
            <p className="text-xs text-muted">{a.contactName} · <a className="underline" href={`mailto:${a.email}`}>{a.email}</a>{a.phone ? ` · ${a.phone}` : ""}{a.website ? <> · <a className="underline" href={a.website} rel="noreferrer nofollow" target="_blank">{a.website}</a></> : null}</p>
            <div className="flex gap-3">
              <ActionButton url={`/api/admin/applications/${a.id}`} method="PATCH" body={{ action: "approve" }} label="Approve (create unpublished listing)" />
              <ActionButton url={`/api/admin/applications/${a.id}`} method="PATCH" body={{ action: "reject" }} label="Reject" confirm="Reject this application?" className="rounded border border-line px-3 py-1.5 text-sm" />
            </div>
          </article>
        ))}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Decided</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted"><tr><th className="py-2">Company</th><th>Status</th><th>Reviewed</th><th>Listing</th></tr></thead>
          <tbody>
            {decided.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="py-2">{a.companyName}</td>
                <td>{a.status}</td>
                <td>{a.reviewedAt ? fmt(a.reviewedAt) : "-"}</td>
                <td>{a.listingId ? <Link className="underline" href="/admin/suppliers">{a.listingId.slice(0, 8)} (unpublished until verified)</Link> : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
