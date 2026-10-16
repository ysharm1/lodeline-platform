import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TODO(week 2): Evidence pack creation + Stripe Checkout
export async function POST() {
  return json({ error: { code: "NOT_IMPLEMENTED", message: "Evidence pack creation + Stripe Checkout is not built yet." } }, 501);
}
