import Link from "next/link";
import { container } from "@/composition/root";
import { requirePageRole } from "../../_lib/guard";
export const dynamic = "force-dynamic";

export default async function Packs() {
  const ctx = await requirePageRole("buyer", "admin");
  const packs = await container().platform().packs.listForBuyer(ctx);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Evidence packs</h1>
      {packs.length === 0 ? <p className="text-muted text-sm">No packs yet. Run a <Link className="underline" href="/audit">free parts audit</Link> and order a pack from the results page.</p> : null}
      <ul className="divide-y divide-line rounded border border-line">
        {packs.map((p) => (
          <li key={p.id} className="p-3 flex justify-between">
            <Link href={`/buyer/packs/${p.id}`} className="underline">{p.audit.sourceFileName} ({p.audit.rowCount} rows)</Link>
            <span className="text-sm text-muted">{p.status.replace("_", " ")} · {p.createdAt.toISOString().slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
