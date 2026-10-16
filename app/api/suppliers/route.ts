import { container } from "@/composition/root";
import { route } from "@/http/api";
import { json } from "@/http/respond";
import { parseFilterParams } from "@/services/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public directory search: ?q=&material=&stage=&country=&excludeCountry=&verified=1 */
export const GET = route(async (req: Request) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await container().platform().directory.search(parseFilterParams(sp));
  return json({ listings: rows });
});
