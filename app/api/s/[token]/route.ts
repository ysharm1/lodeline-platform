import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TODO(week 2): Supplier token context (hash lookup, expiry, revocation)
export async function GET() {
  return json({ error: { code: "NOT_IMPLEMENTED", message: "Supplier token context (hash lookup, expiry, revocation) is not built yet." } }, 501);
}
