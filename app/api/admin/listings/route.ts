import { container } from "@/composition/root";
import { readJson, requireApiContext, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const ctx = await requireApiContext();
  return json({ listing: await container().platform().directory.create(ctx, await readJson(req)) }, 201);
});
