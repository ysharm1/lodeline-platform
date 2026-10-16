import { notFound } from "next/navigation";
import { container } from "@/composition/root";
import { isDomainError } from "@/domain/errors";
import { MATERIAL_LABELS, STAGE_LABELS } from "@/services/stage-rules";
import { Disclaimer } from "../../_components/disclaimer";

export const dynamic = "force-dynamic";

export default async function AuditResults({
  params,
  searchParams,
}: {
  params: Promise<{ auditId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { auditId } = await params;
  const { t } = await searchParams;
  let data;
  try {
    data = await container().freeAudit.results(auditId, t);
  } catch (e) {
    if (isDomainError(e)) notFound();
    throw e;
  }
  const { audit, parts, summary } = data;
  const flagged = parts.filter((p) => p.undocumentedStages.length > 0);
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="font-mono text-xs text-muted">Audit {audit.id.slice(0, 8)} · {audit.sourceFileName}</p>
        <h1 className="text-3xl font-semibold">
          {summary.flagged} of {summary.total} parts likely contain covered material
        </h1>
        <p className="text-muted text-sm">
          Results are &ldquo;likely&rdquo; classifications from part descriptions ({audit.llmModel ?? "keyword"} ·{" "}
          {audit.promptVersion}). No supplier documents are on file yet, so every required upstream stage is shown as
          undocumented.
        </p>
      </header>
      {flagged.length ? (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead className="bg-ink-2 text-left text-muted">
              <tr>
                <th className="p-3">Part</th>
                <th className="p-3">Description</th>
                <th className="p-3">Supplier</th>
                <th className="p-3">Likely material</th>
                <th className="p-3">Undocumented stages</th>
              </tr>
            </thead>
            <tbody>
              {flagged.map((p) => (
                <tr key={p.id} className="border-t border-line align-top">
                  <td className="p-3 font-mono">{p.partNumber ?? "-"}</td>
                  <td className="p-3">
                    {p.description}
                    <div className="text-xs text-muted">{p.llmRationale} ({Math.round((p.llmConfidence ?? 0) * 100)}%)</div>
                  </td>
                  <td className="p-3">{p.supplierName ?? "-"}</td>
                  <td className="p-3">{p.materials.map((m) => MATERIAL_LABELS[m]).join(", ")}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {p.undocumentedStages.map((s) => (
                        <span key={s} className="rounded border border-gap/60 px-2 py-0.5 text-xs text-gap">
                          {STAGE_LABELS[s]} · no document
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">No parts were flagged as likely containing covered material.</p>
      )}
      <section className="rounded border border-line bg-ink-2 p-5 space-y-2">
        <h2 className="font-semibold">Next step: an evidence pack</h2>
        <p className="text-sm text-muted">
          We request origin documents from your suppliers, match each to a stage, and hand over a pack with gaps and next
          questions. (Checkout coming soon. Email info@lodeline.org.)
        </p>
      </section>
      <Disclaimer />
    </div>
  );
}
