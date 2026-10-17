import { container } from "@/composition/root";
import { requirePageRole } from "../../_lib/guard";
import { ActionButton } from "../../_components/action-button";
export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" }) + " MST";

/** Admin: lodeline.org readiness-call requests and checklist downloads. */
export default async function AdminLeads() {
  const ctx = await requirePageRole("admin");
  const leads = await container().platform().leads.list(ctx);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Website leads</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr><th className="py-2">Received</th><th>Kind</th><th>Contact</th><th>Supplies / message</th><th>Notified</th><th>Status</th></tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id} className="border-t border-line align-top">
              <td className="py-2 whitespace-nowrap">{fmt(l.createdAt)}</td>
              <td>{l.kind === "readiness_call" ? "Readiness call" : "Checklist"}</td>
              <td>
                {l.name ? <div>{l.name}</div> : null}
                <div>{l.company}</div>
                <a className="underline text-xs" href={`mailto:${l.email}`}>{l.email}</a>
                {l.phone ? <div className="text-xs">{l.phone}</div> : null}
              </td>
              <td className="max-w-md">
                {l.supplies ? <div className="text-xs text-muted">{l.supplies}</div> : null}
                {l.message ? <div className="whitespace-pre-wrap">{l.message}</div> : null}
              </td>
              <td>{l.notifiedAt ? "yes" : <span className="text-gap">no</span>}</td>
              <td className="space-x-2 whitespace-nowrap">
                <span>{l.status}</span>
                {l.status !== "contacted" ? <ActionButton url={`/api/admin/leads/${l.id}`} method="PATCH" body={{ status: "contacted" }} label="Contacted" className="text-xs underline" /> : null}
                {l.status !== "closed" ? <ActionButton url={`/api/admin/leads/${l.id}`} method="PATCH" body={{ status: "closed" }} label="Close" className="text-xs underline" /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
