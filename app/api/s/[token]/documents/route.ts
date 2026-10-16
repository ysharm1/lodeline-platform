import { container } from "@/composition/root";
import { readJson, route } from "@/http/api";
import { json } from "@/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Step 2: after the browser PUT, process the file (checks, text, claims, geocoding). */
export const POST = route(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  const body = await readJson(req);
  return json(await container().platform().intake.completeUpload(token, body.documentId));
});
