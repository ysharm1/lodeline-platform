import { container } from "@/composition/root";
import { errorResponse, json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ auditId: string }> }) {
  try {
    const { auditId } = await params;
    const token = new URL(req.url).searchParams.get("t") ?? req.headers.get("x-audit-token");
    return json(await container().freeAudit.results(auditId, token));
  } catch (e) {
    return errorResponse(e);
  }
}
