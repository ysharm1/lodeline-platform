import { container } from "@/composition/root";
import { isDomainError } from "@/domain/errors";
import { STAGE_LABELS } from "@/services/stage-rules";
import type { Stage } from "@/domain/types";
import { SupplierUpload } from "./upload";
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
  const { request, parts, buyerName } = data;
  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Origin documents for {buyerName}</h1>
        <p className="text-muted text-sm">For {request.supplier.name}. This private link expires {request.tokenExpiresAt.toISOString().slice(0, 10)} (UTC).</p>
      </header>
      <section className="space-y-2">
        <h2 className="font-semibold">What is requested</h2>
        <p className="text-sm">For each stage below, a certificate or declaration naming the facility, its address and country:</p>
        <ul className="list-disc pl-5 text-sm">{(request.stagesRequested as Stage[]).map((s) => <li key={s}>{STAGE_LABELS[s]}</li>)}</ul>
        <p className="text-sm text-muted">Parts: {parts.map((p) => p.partNumber ?? p.description).join(", ")}</p>
      </section>
      <div className="rounded border border-gap/50 bg-gap/10 p-3 text-sm">PDF certificates or declarations only (max 20 MB). Do not upload drawings, controlled technical data or export-controlled information; these are rejected automatically.</div>
      <SupplierUpload token={token} turnstileSiteKey={process.env.TURNSTILE_SITE_KEY} />
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
