import { container } from "@/composition/root";
import { requirePageRole } from "../../_lib/guard";
import { ActionButton } from "../../_components/action-button";
export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" }) + " MST";

/** Admin: marketplace intro requests. Staff make the introduction by email, then mark it. */
export default async function Intros() {
  const ctx = await requirePageRole("admin");
  const rows = await container().platform().intros.listAll(ctx);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Intro requests</h1>
      <ul className="divide-y divide-line rounded border border-line text-sm">
        {rows.map((r) => (
          <li key={r.id} className="p-3 space-y-1">
            <p><strong>{r.listing.name}</strong> <span className="text-muted">({r.listing.listingStatus})</span> ← {r.org?.name ?? "no org"} · {r.user.email}</p>
            {r.message ? <p className="whitespace-pre-wrap">{r.message}</p> : null}
            <p className="text-xs text-muted flex items-center gap-3">
              {fmt(r.createdAt)} · {r.status}
              {r.status !== "introduced" ? <ActionButton url={`/api/admin/intros/${r.id}`} method="PATCH" body={{ status: "introduced" }} label="Introduced" className="text-xs underline" /> : null}
              {r.status !== "closed" ? <ActionButton url={`/api/admin/intros/${r.id}`} method="PATCH" body={{ status: "closed" }} label="Close" className="text-xs underline" /> : null}
            </p>
          </li>
        ))}
        {rows.length === 0 ? <li className="p-3 text-muted">No intro requests.</li> : null}
      </ul>
    </div>
  );
}
