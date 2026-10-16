import { container } from "@/composition/root";
import { route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const { request, parts, buyerName } = await container().platform().suppliers.resolveToken(token);
  return json({
    buyerName,
    supplierName: request.supplier.name,
    stagesRequested: request.stagesRequested,
    expiresAt: request.tokenExpiresAt,
    parts: parts.map((p) => ({ partNumber: p.partNumber, description: p.description })),
    documents: request.documents.map((d) => ({ id: d.id, fileName: d.fileName, status: d.status, rejectionReason: d.rejectionReason })),
  });
});
