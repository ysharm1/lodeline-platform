import { container } from "@/composition/root";
import { usd } from "@/services/pricing";
import { requirePageRole } from "../../_lib/guard";
import { QuoteForm } from "./quote-form";
export const dynamic = "force-dynamic";

/** Audits larger than the Standard pack. Setting a quote lets the buyer order a Custom pack from the results page. */
export default async function AdminQuotes() {
  const ctx = await requirePageRole("admin");
  const rows = await container().platform().packs.quoteQueue(ctx);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Custom quotes</h1>
      <p className="text-sm text-muted">Parts lists larger than the Standard pack (15 parts, 8 suppliers). Once a quote is set, the buyer sees an order button at that fixed price on their results page.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-muted"><tr><th className="py-2">Audit</th><th>Lead</th><th>Scope</th><th>Quote</th><th /></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-line align-top">
              <td className="py-2"><span className="font-mono">{a.id.slice(0, 8)}</span> · {a.sourceFileName}<div className="text-xs text-muted">{a.createdAt.toISOString().slice(0, 10)}</div></td>
              <td>{a.companyName ?? "-"}<div className="text-xs text-muted">{a.leadEmail}</div></td>
              <td>{a.scope.parts} parts · {a.scope.suppliers} suppliers</td>
              <td>{a.quotedPriceCents ? `${usd(a.quotedPriceCents)} · ${a.quotedMaxSuppliers} suppliers` : "-"}</td>
              <td><QuoteForm auditId={a.id} suppliers={a.scope.suppliers} current={a.quotedPriceCents} /></td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><td className="py-3 text-muted" colSpan={5}>No audits need a quote.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
