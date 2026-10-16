import Link from "next/link";
import { Disclaimer } from "./_components/disclaimer";

const STAGES = ["Mine", "Separate", "Metal & alloy", "Magnet"];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="space-y-5 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">NdFeB · SmCo · Tungsten · Tantalum</p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Know what your magnet-origin evidence supports.</h1>
        <p className="text-lg text-muted">
          Upload a parts list. Lodeline flags the parts likely to contain covered magnets, tungsten or tantalum,
          and shows which upstream stages have no supplier document yet.
        </p>
        <div className="flex gap-3">
          <Link href="/audit" className="rounded bg-paper text-ink px-4 py-2 font-medium">Run a free parts audit</Link>
          <Link href="/login" className="rounded border border-line px-4 py-2">Sign in</Link>
        </div>
        <Disclaimer />
      </section>
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STAGES.map((s, i) => (
          <div key={s} className="rounded border border-line bg-ink-2 p-4">
            <p className="font-mono text-xs text-muted">0{i + 1}</p>
            <p className="font-medium">{s}</p>
            <p className="text-xs text-gap mt-1">No document yet</p>
          </div>
        ))}
      </section>
      <p className="text-xs text-muted">
        From 1 January 2027 DFARS 252.225-7052 also covers material mined, refined or separated in a covered country.
        Confirm the clause version in your contract.
      </p>
    </div>
  );
}
