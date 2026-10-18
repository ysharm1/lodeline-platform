import { notFound } from "next/navigation";
import { container } from "@/composition/root";
import { isDomainError } from "@/domain/errors";
import { MATERIAL_LABELS, STAGE_LABELS } from "@/services/stage-rules";
import { scopeOfParts, tierForScope, usd } from "@/services/pricing";
import { Disclaimer } from "../../_components/disclaimer";
import { ActionButton } from "../../_components/action-button";
import { auditNeeds } from "@/services/matchmaker";

export const dynamic = "force-dynamic";

export default async function AuditResults({
  params,
  searchParams,
}: {
  params: Promise<{ auditId: string }>;
  searchParams: Promise<{ t?: string; demo?: string }>;
}) {
  const { auditId } = await params;
  const { t, demo } = await searchParams;
  let data;
  try {
    data = await container().freeAudit.results(auditId, t);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const { audit, parts, summary, coverage } = data;
  const likely = parts.filter((p) => p.coverage === "likely");
  const possible = parts.filter((p) => p.coverage === "possible");
  const notLikely = parts.filter((p) => p.coverage === "not_likely");
  // The pack tier and price follow from this audit's scope (src/services/pricing.ts).
  const scope = scopeOfParts(parts);
  const tier = tierForScope(scope);
  // Custom scope: staff can set a fixed quote for this audit (/admin/quotes); then it can be ordered here.
  const quoted = tier.priceCents === null ? (audit.quotedPriceCents ?? null) : null;
  // Matchmaker: directory sources outside the covered countries for each flagged material x stage.
  let matches: Awaited<ReturnType<ReturnType<ReturnType<typeof container>["platform"]>["directory"]["matchesForNeeds"]>> = [];
  try {
    matches = await container().platform().directory.matchesForNeeds(auditNeeds(parts));
  } catch {
    matches = [];
  }
  return (
    <div className="space-y-8">
      {demo === "1" ? (
        <p className="rounded border border-accent/60 bg-accent/10 p-3 text-sm">
          Free demo: a fictional parts list run through the real audit pipeline. Bookmark this page to come back to it, or{" "}
          <a href="/audit" className="underline">upload your own parts list</a>.
        </p>
      ) : null}
      <header className="space-y-2">
        <p className="font-mono text-xs text-muted">Audit {audit.id.slice(0, 8)} · {audit.sourceFileName}</p>
        <h1 className="text-3xl font-semibold">
          {coverage.likely} likely covered, {coverage.possible} to confirm with suppliers, of {summary.total} parts
        </h1>
        <p className="text-muted text-sm">
          Each part is sorted into <strong>likely covered</strong>, <strong>possible: confirm with supplier</strong> or{" "}
          <strong>likely not covered</strong>, with the rule, manufacturer/MPN pattern or column behind it ({audit.llmModel ?? "rules"} ·{" "}
          {audit.promptVersion}). These are classifications from your parts list, not supplier evidence. No supplier documents
          are on file yet, so every required upstream stage is shown as undocumented.
        </p>
      </header>
      <PartsTable title="Likely covered" note="A covered material is named in the row or by a verified manufacturer/MPN pattern." parts={likely} showStages empty="No parts were classified as likely covered." />
      <PartsTable
        title="Possible: confirm with supplier"
        note="A weaker, class-level or conflicting signal. These are not cleared: ask the supplier which magnet, alloy or capacitor material is used."
        parts={possible}
        showStages
        empty="No parts need confirmation."
      />
      <details className="rounded border border-line" open={notLikely.length <= 15}>
        <summary className="cursor-pointer p-3 font-semibold">
          Likely not covered ({notLikely.length}) <span className="text-sm font-normal text-muted">· each with the reason</span>
        </summary>
        <PartsTable parts={notLikely} empty="None." />
      </details>
      {matches.length ? (
        <section className="space-y-2" data-testid="audit-matches">
          <h2 className="text-xl font-semibold">Sources in the directory</h2>
          <p className="text-sm text-muted">Directory suppliers that list each flagged material and stage, outside China, Russia, Iran and North Korea. Leads to ask, not evidence.</p>
          <ul className="text-sm space-y-1">
            {matches.map((m) => (
              <li key={`${m.material}-${m.stage}`}>
                <span className="text-muted">{MATERIAL_LABELS[m.material]} · {STAGE_LABELS[m.stage]}:</span>{" "}
                {m.suggestions.length
                  ? m.suggestions.map((sg, i) => <span key={sg.id}>{i ? ", " : ""}<a className="underline" href={`/suppliers/${sg.id}`}>{sg.name}</a>{sg.verified ? " (verified)" : ""}</span>)
                  : <a className="underline text-muted" href={`/suppliers?material=${m.material}&stage=${m.stage}&excludeCovered=1`}>no listing yet</a>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="rounded border border-line bg-ink-2 p-5 space-y-2">
        <h2 className="font-semibold">Next step: an evidence pack</h2>
        <p className="text-sm text-muted">
          We request origin documents from your suppliers, match each to a stage, and hand over a pack with gaps and next
          questions. Fixed fee, paid by card through Stripe.
        </p>
        {summary.flagged > 0 ? (
          <p className="text-sm">
            Your scope: <strong>{scope.parts} part{scope.parts === 1 ? "" : "s"}</strong> to document
            {scope.suppliers ? <> from <strong>{scope.suppliers} named supplier{scope.suppliers === 1 ? "" : "s"}</strong></> : null}.{" "}
            {tier.priceCents === null ? (
              quoted ? (
                <>That is larger than our Standard pack. Your fixed quote: <strong>{usd(quoted)}</strong>, covering up to {audit.quotedMaxSuppliers ?? scope.suppliers} suppliers.</>
              ) : (
                <>That is larger than our Standard pack, so we price it as a fixed quote.</>
              )
            ) : (
              <>
                That fits the <strong>{tier.label}</strong> pack: <strong>{usd(tier.priceCents)}</strong>, covering up to {tier.maxParts} parts and {tier.maxSuppliers} suppliers.
              </>
            )}
          </p>
        ) : null}
        {audit.status === "classified" && summary.flagged > 0 && tier.priceCents !== null ? (
          <ActionButton url="/api/packs" body={{ auditId: audit.id, accessToken: t }} label={`Order the ${tier.label} pack (${usd(tier.priceCents)})`} />
        ) : null}
        {audit.status === "classified" && summary.flagged > 0 && quoted ? (
          <ActionButton url="/api/packs" body={{ auditId: audit.id, accessToken: t }} label={`Order the Custom pack (${usd(quoted)})`} />
        ) : null}
        {audit.status === "classified" && summary.flagged > 0 && tier.priceCents === null && !quoted ? (
          <a href="/#contact" className="inline-block rounded bg-accent text-ink px-3 py-1.5 text-sm font-medium">Request a quote</a>
        ) : null}
      </section>
      <Disclaimer />
    </div>
  );
}

type Part = Awaited<ReturnType<ReturnType<typeof container>["freeAudit"]["results"]>>["parts"][number];

function PartsTable({ title, note, parts, showStages, empty }: { title?: string; note?: string; parts: Part[]; showStages?: boolean; empty: string }) {
  return (
    <section className="space-y-2">
      {title ? (
        <div>
          <h2 className="text-xl font-semibold">
            {title} ({parts.length})
          </h2>
          {note ? <p className="text-sm text-muted">{note}</p> : null}
        </div>
      ) : null}
      {parts.length ? (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead className="bg-ink-2 text-left text-muted">
              <tr>
                <th className="p-3">Part</th>
                <th className="p-3">Description</th>
                <th className="p-3">Manufacturer / supplier</th>
                <th className="p-3">Material</th>
                <th className="p-3">Why</th>
                {showStages ? <th className="p-3">Undocumented stages</th> : null}
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id} className="border-t border-line align-top">
                  <td className="p-3 font-mono">
                    {p.partNumber ?? "-"}
                    {p.mpn && p.mpn !== p.partNumber ? <div className="text-xs text-muted">MPN {p.mpn}</div> : null}
                  </td>
                  <td className="p-3">
                    {p.description}
                    {p.material ? <div className="text-xs text-muted">Material column: {p.material}</div> : null}
                  </td>
                  <td className="p-3">{[p.manufacturer, p.supplierName && p.supplierName !== p.manufacturer ? p.supplierName : null].filter(Boolean).join(" / ") || "-"}</td>
                  <td className="p-3">
                    {p.coverage === "not_likely"
                      ? "-"
                      : p.materials.length
                        ? p.materials.map((m) => MATERIAL_LABELS[m]).join(p.coverage === "possible" ? " or " : ", ")
                        : "Unknown: confirm"}
                  </td>
                  <td className="p-3 text-xs text-muted">
                    {p.reason}
                    {p.llmConfidence != null ? ` (${Math.round(p.llmConfidence * 100)}%)` : ""}
                  </td>
                  {showStages ? (
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {p.undocumentedStages.length
                          ? p.undocumentedStages.map((s) => (
                              <span key={s} className="rounded border border-gap/60 px-2 py-0.5 text-xs text-gap">
                                {STAGE_LABELS[s]} · no document
                              </span>
                            ))
                          : <span className="text-xs text-muted">Stages depend on the confirmed material</span>}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted text-sm">{empty}</p>
      )}
    </section>
  );
}

