import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TODO(week 2): Supplier evidence upload with drawing rejection
export async function POST() {
  return json({ error: { code: "NOT_IMPLEMENTED", message: "Supplier evidence upload with drawing rejection is not built yet." } }, 501);
}
