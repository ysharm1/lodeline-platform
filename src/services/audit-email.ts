/**
 * Emails the free-audit results link to the lead. Non-fatal: a failed send is
 * recorded in the audit log and the uploader still sees the link on screen.
 */
import type { AuditService } from "./audit";
import type { EmailSender } from "./notifications";

export async function emailAuditResults(
  d: { email: EmailSender; audit: AuditService; baseUrl: string },
  a: { auditId: string; accessToken: string; leadEmail: string; flagged: number; total: number; ip?: string | null }
): Promise<boolean> {
  const url = `${d.baseUrl.replace(/\/$/, "")}/audit/${a.auditId}?t=${encodeURIComponent(a.accessToken)}`;
  const domain = a.leadEmail.split("@")[1] ?? "";
  try {
    const res = await d.email.send({
      to: a.leadEmail,
      subject: `Your Lodeline parts audit: ${a.flagged} of ${a.total} parts flagged`,
      text:
        `Your free parts audit is ready:\n\n${url}\n\n` +
        `${a.flagged} of ${a.total} parts likely contain NdFeB/SmCo magnets, tungsten or tantalum. ` +
        `For each, the upstream stages without a supplier document are listed.\n\n` +
        `Anyone with this link can view the results; do not forward it outside your company.\n\n` +
        `Lodeline provides supply-chain documentation and analysis, not legal advice or government certification.\n`,
    });
    await d.audit.append({ action: "audit.results_emailed", subjectId: a.auditId, payload: { emailDomain: domain, provider: d.email.name, providerMessageId: res.providerMessageId }, ip: a.ip ?? null });
    return true;
  } catch (e) {
    await d.audit.append({ action: "audit.results_email_failed", subjectId: a.auditId, payload: { emailDomain: domain, provider: d.email.name, error: (e as Error).message.slice(0, 200) }, ip: a.ip ?? null });
    return false;
  }
}
