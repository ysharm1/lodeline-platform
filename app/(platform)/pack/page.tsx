import Link from "next/link";
import { getAuthContext } from "@/http/auth-context";
import { packPriceCents } from "@/infra/billing";
import { Disclaimer } from "../_components/disclaimer";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Get the evidence pack",
  description: "A fixed-fee, stage-by-stage evidence pack for the parts your free audit flags. Paid by card through Stripe.",
  alternates: { canonical: "/pack" },
};

const INCLUDED = [
  "Supplier outreach: a private, expiring upload link per supplier, with reminders on days 3, 7 and 14",
  "Every document matched to the production stage it covers, with issuer and date",
  "Claims cite the document verbatim and are accepted or rejected by a Lodeline reviewer",
  "Facility locations geocoded and covered countries (China, Russia, Iran, North Korea) flagged",
  "A pack PDF: summary, stage-by-stage records, document register, open questions and stated limits",
];

export default async function PackPage() {
  const ctx = await getAuthContext();
  const price = (packPriceCents() / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return (
    <div className="space-y-8 max-w-3xl">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Evidence pack · {price} fixed fee</p>
        <h1 className="text-4xl font-semibold tracking-tight">Get the evidence pack.</h1>
        <p className="text-muted">
          A pack starts from a free parts audit. Run the audit on your parts list, then choose <b>Order an evidence pack</b> on the results page. You
          pay by card through Stripe Checkout and we start supplier outreach.
        </p>
      </header>
      <ol className="space-y-3">
        <li className="rounded border border-line bg-ink-2 p-4">
          <p className="font-mono text-xs text-muted">Step 1</p>
          <p className="font-medium">Run the free parts audit</p>
          <p className="text-sm text-muted">CSV or XLSX parts list only. No drawings or controlled data.</p>
          <div className="mt-3 flex gap-4 text-sm">
            <Link href="/audit" className="rounded bg-accent text-ink px-3 py-1.5 font-medium">Upload a parts list</Link>
            <Link href="/demo" className="underline self-center">Or try the demo first</Link>
          </div>
        </li>
        <li className="rounded border border-line bg-ink-2 p-4">
          <p className="font-mono text-xs text-muted">Step 2</p>
          <p className="font-medium">Order the pack from your results ({price})</p>
          <p className="text-sm text-muted">{ctx ? "You are signed in." : "You will be asked to sign in with a one-time email link."} Your packs appear under Evidence packs.</p>
          {ctx ? <Link href="/buyer/packs" className="text-sm underline">Go to my evidence packs</Link> : <Link href="/login?next=/buyer/packs" className="text-sm underline">Sign in</Link>}
        </li>
      </ol>
      <section className="space-y-2">
        <h2 className="font-semibold">What is included</h2>
        <ul className="list-disc pl-5 text-sm text-muted space-y-1">{INCLUDED.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="text-sm">See the format: <a href="/sample-evidence-pack" className="underline">sample evidence pack</a>. Need a larger scope? <a href="/#contact" className="underline">Request a readiness call</a> or call Yash Sharma at <a href="tel:+16023159861" className="underline">(602) 315-9861</a>.</p>
      </section>
      <Disclaimer />
    </div>
  );
}
