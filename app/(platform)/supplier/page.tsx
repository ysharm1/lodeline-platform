import { requirePageRole } from "../_lib/guard";
import { Stub } from "../_components/stub";
export const dynamic = "force-dynamic";
export default async function SupplierHome() {
  await requirePageRole("supplier", "admin");
  return <Stub title="Evidence requests">{/* TODO: supplier accounts (suppliers use /s/[token] for now) */}</Stub>;
}
