import Link from "next/link";
import { container } from "@/composition/root";
import { usd } from "@/services/pricing";
import { requirePageRole } from "../../_lib/guard";
import { ActionButton } from "../../_components/action-button";
export const dynamic = "force-dynamic";

/** Buyer refresh plans (monthly). Re-check each pack when due, then mark it refreshed. */
export default async function AdminRefresh() {
  const ctx = await requirePageRole("admin");
  const rows = await container().platform().refresh.list(ctx);
  const now = new Date();
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Refresh plans</h1>
        <p className="text-sm text-muted">
          Each active plan is a buyer paying monthly to keep one pack current. When a plan is due, re-request expiring or missing documents from the
          pack&apos;s suppliers, regenerate the PDF, then mark it refreshed. That sets the next due date.
        </p>
      </header>
      <table className="w-full text-sm">
        <thead className="text-left text-muted"><tr><th className="py-2">Pack</th><th>Buyer</th><th>Plan</th><th>Status</th><th>Next due</th><th>Last refreshed</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => {
            const due = r.status === "active" && r.nextRefreshDueAt && r.nextRefreshDueAt <= now;
            return (
              <tr key={r.id} className="border-t border-line">
                <td className="py-2"><Link className="underline" href={`/buyer/packs/${r.packId}`}>{r.packId.slice(0, 8)} · {r.pack.audit.sourceFileName}</Link></td>
                <td>{r.pack.org.name}</td>
                <td>{r.tier} · {usd(r.monthlyCents)}/mo</td>
                <td>{r.status}</td>
                <td className={due ? "text-gap font-medium" : ""}>{r.nextRefreshDueAt ? r.nextRefreshDueAt.toISOString().slice(0, 10) : "-"}{due ? " (due)" : ""}</td>
                <td>{r.lastRefreshedAt ? r.lastRefreshedAt.toISOString().slice(0, 10) : "-"}</td>
                <td>{r.status === "active" ? <ActionButton url={`/api/admin/refresh/${r.id}`} label="Mark refreshed" confirm="Mark this pack as re-checked? This sets the next due date." className="text-xs underline" /> : null}</td>
              </tr>
            );
          })}
          {rows.length === 0 ? <tr><td colSpan={7} className="py-3 text-muted">No refresh plans yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
