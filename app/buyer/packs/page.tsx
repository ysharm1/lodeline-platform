import { redirect } from "next/navigation";
import { getAuthContext } from "@/http/auth-context";
import { Stub } from "../../_components/stub";
export const dynamic = "force-dynamic";
export default async function Packs() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  return <Stub title="Evidence packs">{/* TODO(week 2): list packs for ctx.orgId */}</Stub>;
}
