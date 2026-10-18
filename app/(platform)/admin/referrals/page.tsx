import { SUPPLIER_COMMISSIONS_ENABLED } from "@/services/pricing";
import { requirePageRole } from "../../_lib/guard";
export const dynamic = "force-dynamic";

/**
 * Referrals. Supplier-paid commissions are switched off in
 * src/services/pricing.ts until a government contracts lawyer has reviewed
 * the structure. See docs/business-model.md, "Sourcing introductions".
 */
export default async function Page() {
  await requirePageRole("admin");
  return (
    <section className="space-y-3 max-w-3xl">
      <h1 className="text-2xl font-semibold">Referrals</h1>
      <p className="text-sm">
        Supplier commissions: <strong>{SUPPLIER_COMMISSIONS_ENABLED ? "on" : "off"}</strong>.
      </p>
      <p className="text-sm text-muted">
        Lodeline does not take commissions from suppliers. A supplier paying us when a buyer switches to it would give us a reason to find gaps in the
        buyer&apos;s current suppliers, and could raise federal Anti-Kickback Act questions on defense subcontracts. Until a government contracts lawyer
        approves a structure, sourcing help is a flat fee paid by the buyer, quoted by email. The Referral and CommissionInvoice tables stay in the
        database, unused.
      </p>
    </section>
  );
}
