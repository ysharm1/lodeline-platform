import { NextResponse } from "next/server";
import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";
import { setupOrg } from "@/services/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Customer onboarding: name the company (creates the org + org-admin membership). Form posts redirect to /app. */
export const POST = route(async (req: Request) => {
  const ctx = await requireApiContext();
  const isForm = (req.headers.get("content-type") ?? "").includes("form");
  const name = isForm ? (await req.formData()).get("name") : (await readJson(req)).name;
  const r = await setupOrg(container().platform().deps, ctx, name);
  if (isForm) return NextResponse.redirect(new URL("/app", req.url), 303);
  return json(r, r.created ? 201 : 200);
});
