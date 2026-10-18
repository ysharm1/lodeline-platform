import { container } from "@/composition/root";
import { isDomainError } from "@/domain/errors";
import { STAGE_LABELS } from "@/services/stage-rules";
import type { Stage } from "@/domain/types";
import { SupplierUpload } from "./upload";
import { ReuseConsent } from "./consent";
import { ForwardStage } from "./forward";
import { Disclaimer } from "../../_components/disclaimer";
export const dynamic = "force-dynamic";

export default async function SupplierPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data;
  try {
    data = await container().platform().suppliers.resolveToken(token);
  } catch (e) {
    if (isDomainError(e)) return <div className="max-w-xl space-y-2"><h1 className="text-2xl font-semibold">Link unavailable</h1><p className="text-muted">{e.message}</p></div>;
    throw e;
  }
  const { request, parts, buyerName, purpose, reuseConsent, stages } = data;
  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{purpose === "verification" ? "Your Lodeline supplier verification" : `Origin documents for ${buyerName}`}</h1>
        <p className="text-muted text-sm">For {request.supplier.name}. This private link expires {request.tokenExpiresAt.toISOString().slice(0, 10)} (UTC).</p>
        {request.parent ? <p className="text-sm text-muted">Forwarded to you by {request.parent.supplier.name}, who buys from you for the stages below.</p> : null}
      </header>
      <section className="space-y-2">
        <h2 className="font-semibold">What is requested</h2>
        <p className="text-sm">For each stage below, a certificate or declaration naming the facility, its address and country. If another company performs a stage for you, forward that stage to them.</p>
        {purpose === "pack" ? <p className="text-sm text-muted">Parts: {parts.map((p) => p.partNumber ?? p.description).join(", ")}</p> : null}
      </section>
      <div className="rounded border border-gap/50 bg-gap/10 p-3 text-sm">PDF certificates or declarations only (max 20 MB). Do not upload drawings, controlled technical data or export-controlled information; these are rejected automatically.</div>
      <ol className="space-y-4" data-testid="stage-forms">
        {stages.map((st, i) => (
          <li key={st.stage} className="rounded border border-line p-4 space-y-3" data-stage={st.stage}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{i + 1}. {STAGE_LABELS[st.stage as Stage]}</h3>
              <span className="text-xs text-muted">
                {st.documents.length ? `${st.documents.length} document(s) received` : st.forwardedTo.length ? "forwarded upstream" : "nothing yet"}
              </span>
            </div>
            <SupplierUpload token={token} turnstileSiteKey={process.env.TURNSTILE_SITE_KEY} stage={st.stage} label={`Upload for ${STAGE_LABELS[st.stage as Stage]}`} />
            {st.forwardedTo.length ? (
              <ul className="text-sm text-muted">{st.forwardedTo.map((f) => <li key={f.requestId}>Forwarded to {f.supplierName} · {f.outreachStatus} · {f.documents} document(s)</li>)}</ul>
            ) : null}
            {purpose === "pack" ? <ForwardStage token={token} stage={st.stage} stageLabel={STAGE_LABELS[st.stage as Stage]} /> : null}
          </li>
        ))}
      </ol>
      <section className="space-y-2">
        <h2 className="font-semibold">One document covering several stages?</h2>
        <SupplierUpload token={token} turnstileSiteKey={process.env.TURNSTILE_SITE_KEY} />
      </section>
      <ReuseConsent token={token} initial={reuseConsent} purpose={purpose} />
      {request.documents.length ? (
        <section>
          <h2 className="font-semibold mb-1">Uploaded so far</h2>
          <ul className="text-sm text-muted">{request.documents.filter((d) => d.status !== "requested").map((d) => <li key={d.id}>{d.fileName}: {d.status === "rejected" ? `not accepted (${d.rejectionReason})` : "received"}</li>)}</ul>
        </section>
      ) : null}
      <Disclaimer />
    </div>
  );
}
