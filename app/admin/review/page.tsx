import { requirePageRole } from "../../_lib/guard";
import { Stub } from "../../_components/stub";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageRole("admin");
  return <Stub title="Review queue">{/* TODO(week 3: side-by-side PDF page view, accept/edit/reject claims) */}</Stub>;
}
