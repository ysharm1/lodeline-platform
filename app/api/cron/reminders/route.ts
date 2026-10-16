import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TODO(week 2): Outreach reminder cron (CRON_SECRET-protected)
export async function POST() {
  return json({ error: { code: "NOT_IMPLEMENTED", message: "Outreach reminder cron (CRON_SECRET-protected) is not built yet." } }, 501);
}
