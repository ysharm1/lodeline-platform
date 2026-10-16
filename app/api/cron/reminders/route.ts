import { timingSafeEqual } from "node:crypto";
import { container } from "@/composition/root";
import { route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Vercel Cron sends "Authorization: Bearer $CRON_SECRET"; Render cron uses the same header via curl.
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

const run = route(async (req: Request) => {
  if (!authorized(req)) return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
  return json(await container().platform().suppliers.runReminders());
});
export const GET = run;
export const POST = run;
