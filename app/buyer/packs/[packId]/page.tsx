import { redirect } from "next/navigation";
import { getAuthContext } from "@/http/auth-context";
import { Stub } from "../../../_components/stub";
export const dynamic = "force-dynamic";
export default async function Pack() {
  if (!(await getAuthContext())) redirect("/login");
  return <Stub title="Evidence pack">{/* TODO(week 2-3): supplier requests, stage status, PDF */}</Stub>;
}
