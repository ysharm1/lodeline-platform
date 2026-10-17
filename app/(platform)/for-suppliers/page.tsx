import { ApplyForm } from "./apply-form";
import { Disclaimer } from "../_components/disclaimer";

export const metadata = {
  title: "For suppliers: get listed as a documented source",
  description: "Magnet, alloy, separation, refining and mining suppliers can apply to be listed in the Lodeline supplier directory as a documented source.",
  alternates: { canonical: "/for-suppliers" },
};

export default function ForSuppliersPage() {
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
      <section className="space-y-4">
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
        <p className="text-sm text-muted">
          Do not send drawings, controlled technical data or export-controlled information. Questions: <a className="underline" href="mailto:info@lodeline.org">info@lodeline.org</a> · Yash Sharma <a className="underline" href="tel:+16023159861">(602) 315-9861</a>
        </p>
        <Disclaimer />
      </section>
      <ApplyForm turnstileSiteKey={process.env.TURNSTILE_SITE_KEY} />
    </div>
  );
}
