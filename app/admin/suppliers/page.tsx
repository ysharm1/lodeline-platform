import { requirePageRole } from "../../_lib/guard";
import { Stub } from "../../_components/stub";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageRole("admin");
  return <Stub title="Suppliers">{/* TODO(week 2) */}</Stub>;
}
