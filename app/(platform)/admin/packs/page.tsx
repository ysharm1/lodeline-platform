import Link from "next/link";
import { container } from "@/composition/root";
import { requirePageRole } from "../../_lib/guard";
import { ActionButton } from "../../_components/action-button";
export const dynamic = "force-dynamic";

export default async function AdminPacks() {
  const ctx = await requirePageRole("admin");
  const packs = await container().platform().packs.listForBuyer(ctx);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Packs</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted"><tr><th className="py-2">Pack</th><th>Status</th><th>Paid</th><th>Fee</th><th>PDF</th><th /></tr></thead>
        <tbody>
          {packs.map((p) => (
            <tr key={p.id} className="border-t border-line">
              <td className="py-2"><Link className="underline" href={`/buyer/packs/${p.id}`}>{p.id.slice(0, 8)} · {p.audit.sourceFileName}</Link></td>
              <td>{p.status}</td>
              <td>{p.paidAt ? p.paidAt.toISOString().slice(0, 10) : "-"}</td>
              <td>${(p.priceCents / 100).toLocaleString("en-US")}</td>
              <td>{p.generatedAt ? p.generatedAt.toISOString().slice(0, 10) : "-"}</td>
              <td>{p.paidAt ? <ActionButton url={`/api/admin/packs/${p.id}/generate`} label="Generate PDF + mark ready" className="text-xs underline" /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
