import Link from "next/link";
import { ActionButton } from "../_components/action-button";
import { Disclaimer } from "../_components/disclaimer";
import { DEMO_PARTS_CSV } from "@/services/demo-sample";

export const metadata = {
  title: "Free demo",
  description: "Run a fictional motor and actuator parts list through the Lodeline free parts audit. No sign-up.",
  alternates: { canonical: "/demo" },
};

const WORKFLOW = [
  ["Directory", "Search documented suppliers by material, stage and country.", "/suppliers"],
  ["Free audit", "Upload a parts list. We flag parts likely to contain covered material and the stages with no document.", "/audit"],
  ["Evidence pack", "Order a fixed-fee pack for the flagged parts, paid by card.", "/pack"],
  ["Supplier uploads", "Each supplier gets a private, expiring link to upload origin documents. Drawings are rejected.", null],
  ["Review", "Every extracted claim cites the document verbatim and is accepted or rejected by a Lodeline reviewer.", null],
  ["Pack PDF", "A stage-by-stage record per part, with covered-country flags, a document register and open questions.", "/sample-evidence-pack"],
  ["Referral", "Where a stage has no documented source, we can introduce documented suppliers from the directory.", "/suppliers"],
] as const;

export default function DemoPage() {
  const rows = DEMO_PARTS_CSV.trim().split("\n").map((l) => l.split(","));
  return (
    <div className="space-y-10">
      <header className="space-y-3 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Free demo · no sign-up</p>
        <h1 className="text-4xl font-semibold tracking-tight">See the free parts audit on a sample list.</h1>
        <p className="text-muted">
          This runs a fictional motor and actuator parts list through the same pipeline as a real audit: parse, classify each part for NdFeB or SmCo
          magnets, tungsten and tantalum, and list the upstream stages that have no supplier document yet.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <ActionButton url="/api/demo" label="Run the demo audit" className="rounded bg-accent text-ink px-4 py-2 font-medium disabled:opacity-50" />
          <a href="/api/demo/sample-parts-list" className="text-sm underline">Download the sample CSV</a>
          <Link href="/audit" className="text-sm underline">Upload your own parts list</Link>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="font-semibold">Sample parts list (fictional)</h2>
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead className="bg-ink-2 text-left text-muted">
              <tr>{rows[0].map((h) => <th key={h} className="p-3">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(1).map((r) => (
                <tr key={r[0]} className="border-t border-line">
                  {r.map((c, i) => <td key={i} className={i === 0 ? "p-3 font-mono" : "p-3"}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-semibold">How the platform works, end to end</h2>
        <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {WORKFLOW.map(([title, text, href], i) => (
            <li key={title} className="rounded border border-line bg-ink-2 p-4">
              <p className="font-mono text-xs text-muted">0{i + 1}</p>
              <p className="font-medium">{href ? <Link href={href} className="hover:text-accent">{title}</Link> : title}</p>
              <p className="text-sm text-muted mt-1">{text}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm">
          See the paid output: <a href="/sample-evidence-pack" className="underline">sample evidence pack</a> ·{" "}
          <Link href="/pack" className="underline">get the evidence pack</Link>
        </p>
      </section>
      <Disclaimer />
    </div>
  );
}
