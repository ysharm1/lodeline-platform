import { requirePageRole } from "../../_lib/guard";
import { Stub } from "../../_components/stub";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageRole("admin");
  return <Stub title="Referrals">{/* TODO(later: port commission math from LoadEnergy commission.ts) */}</Stub>;
}
