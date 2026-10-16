import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TODO(week 3): Admin claim accept/edit/reject
export async function PATCH() {
  return json({ error: { code: "NOT_IMPLEMENTED", message: "Admin claim accept/edit/reject is not built yet." } }, 501);
}
