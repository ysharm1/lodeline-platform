import { DEMO_FILE_NAME, DEMO_PARTS_CSV } from "@/services/demo-sample";

export const dynamic = "force-static";

export function GET() {
  return new Response(DEMO_PARTS_CSV, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${DEMO_FILE_NAME}"` },
  });
}
