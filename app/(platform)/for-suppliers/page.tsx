import { ApplyForm } from "./apply-form";
import { Disclaimer } from "../_components/disclaimer";
import { VERIFICATION_TIERS, usd } from "@/services/pricing";

export const metadata = {
  title: "For suppliers: get listed as a documented source",
  description: "Magnet, alloy, separation, refining and mining suppliers can apply to be listed in the Lodeline supplier directory as a documented source.",
  alternates: { canonical: "/for-suppliers" },
};

export const dynamic = "force-dynamic";

export default async function ForSuppliersPage({ searchParams }: { searchParams: Promise<{ verification?: string }> }) {
  const { verification } = await searchParams;
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
      <section className="space-y-4">
        {verification === "paid" ? (
          <p className="rounded border border-accent/60 bg-accent/10 p-3 text-sm">Payment received. We will email you a private link to upload your origin documents.</p>
        ) : null}
        {verification === "cancelled" ? <p className="rounded border border-line p-3 text-sm">Checkout was cancelled. Your payment link still works, or email info@lodeline.org.</p> : null}
        <p className="font-mono text-xs uppercase tracking-widest text-accent">For suppliers</p>
        <h1 className="text-4xl font-semibold tracking-tight">Be listed as a documented source.</h1>
        <p className="text-muted">
          Defense motor and actuator makers use Lodeline to find upstream sources whose origin is documented stage by stage. If you mine, separate,
          refine, make metal and alloy, or make NdFeB or SmCo magnets, tungsten or tantalum products, apply to be listed in the supplier directory.
        </p>
        <ol className="space-y-2 text-sm">
          <li><b>1. Apply.</b> Tell us what you produce, where, and which stages you cover.</li>
          <li><b>2. Review.</b> We review the application. Approved applications get a listing that stays unpublished until verified.</li>
          <li><b>3. Verify.</b> We request origin documents through a private upload link. A listing is only marked <i>verified</i> once Lodeline has reviewed and accepted supporting documents.</li>
        </ol>
        <div className="rounded border border-line bg-ink-2 p-4 space-y-2 text-sm">
          <h2 className="font-semibold">Supplier verification</h2>
          <p className="text-muted">
            Many of your customers will ask for the same origin documents. A verification lets you send them once. We review your documents, and
            with your permission we can use them in your customers&apos; evidence packs, so they don&apos;t have to chase you separately.
          </p>
          <ul className="space-y-1">
            {VERIFICATION_TIERS.map((t) => (
              <li key={t.id}>
                <b>{usd(t.priceCents)} per year</b>: {t.label.toLowerCase()}
              </li>
            ))}
            <li className="text-muted">More than 8 facilities: quoted.</li>
          </ul>
          <p className="text-muted">
            <b>You pay for the review, not the result.</b> The fee is the same whatever your documents show. Paying does not make a listing verified or
            move it up the directory. Directory order depends only on search relevance and accepted evidence. Lodeline does not take commissions on sales.
          </p>
        </div>
        <p className="text-sm text-muted">
          Do not send drawings, controlled technical data or export-controlled information. Questions: <a className="underline" href="mailto:info@lodeline.org">info@lodeline.org</a> · Yash Sharma <a className="underline" href="tel:+16023159861">(602) 315-9861</a>
        </p>
        <Disclaimer />
      </section>
      <ApplyForm turnstileSiteKey={process.env.TURNSTILE_SITE_KEY} />
    </div>
  );
}
