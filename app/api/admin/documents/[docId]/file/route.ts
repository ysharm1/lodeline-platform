import { NextResponse } from "next/server";
import { container } from "@/composition/root";
import { requireApiContext, route } from "@/http/api";
import { requireAdmin } from "@/services/authorization";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: short-lived (5 min) presigned link to the source PDF. */
export const GET = route(async (req: Request, { params }: { params: Promise<{ docId: string }> }) => {
  requireAdmin(await requireApiContext());
  const { docId } = await params;
  const c = container();
  const doc = await c.platform().deps.db.evidenceDocument.findUnique({ where: { id: docId } });
  if (!doc) throw new NotFoundError("DOCUMENT_NOT_FOUND", "Not found.");
  const page = new URL(req.url).searchParams.get("page");
  const url = await c.storage.presignGet(doc.fileKey, 300, doc.fileName);
  return NextResponse.redirect(url + (page ? `#page=${Number(page)}` : ""), 302);
});
