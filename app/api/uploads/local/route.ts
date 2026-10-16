import { container } from "@/composition/root";
import { json } from "@/http/respond";
import { LocalDiskStorage } from "@/services/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DEV ONLY: target of LocalDiskStorage presigned URLs. Disabled when S3 is configured. */
function local() {
  const s = container().storage;
  return s instanceof LocalDiskStorage ? s : null;
}

export async function PUT(req: Request) {
  const s = local();
  if (!s) return json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  const u = new URL(req.url);
  const [key, size, exp, sig] = ["key", "size", "exp", "sig"].map((k) => u.searchParams.get(k) ?? "");
  if (!s.verify(["put", key, size, exp], sig) || Number(exp) * 1000 < Date.now()) return json({ error: { code: "FORBIDDEN", message: "Bad signature" } }, 403);
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength !== Number(size)) return json({ error: { code: "SIZE_MISMATCH", message: "Size mismatch" } }, 400);
  await s.put({ key, body, contentType: req.headers.get("content-type") ?? "application/octet-stream" });
  return new Response(null, { status: 200 });
}

export async function GET(req: Request) {
  const s = local();
  if (!s) return json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  const u = new URL(req.url);
  const [key, exp, sig] = ["key", "exp", "sig"].map((k) => u.searchParams.get(k) ?? "");
  if (!s.verify(["get", key, exp], sig) || Number(exp) * 1000 < Date.now()) return json({ error: { code: "FORBIDDEN", message: "Bad signature" } }, 403);
  const body = await s.get(key);
  if (!body) return json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
  return new Response(new Uint8Array(body), { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}
