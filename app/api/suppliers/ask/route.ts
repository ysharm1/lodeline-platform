import { container } from "@/composition/root";
import { readJson, route } from "@/http/api";
import { clientIp } from "@/http/rate-limit";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public "Ask": NL -> filters -> DB rows -> answer citing only those rows. */
export const POST = route(async (req: Request) => {
  const c = container();
  const rl = await c.limits.ask.check(clientIp(req.headers));
  if (!rl.ok) return json({ error: { code: "RATE_LIMITED", message: "Too many questions. Try again later." } }, 429);
  const body = await readJson(req, 4096);
  const r = await c.platform().directory.ask(body.question);
  return json({ answer: r.answer, citedIds: r.citedIds, filters: r.filters, listings: r.rows, mode: r.mode });
});
