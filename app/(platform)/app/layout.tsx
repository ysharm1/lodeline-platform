import { container } from "@/composition/root";
import { orgSummary } from "@/services/orgs";
import { requirePageRole } from "../_lib/guard";
import { DashboardTabs } from "./_components/tabs";
import { OrgSetup } from "./_components/org-setup";
export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard" };

/** Customer dashboard shell. Signed-out visitors go to /login; supplier-role users get a 404. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageRole("buyer", "admin");
  let org: Awaited<ReturnType<typeof orgSummary>> = null;
  try {
    org = await orgSummary(container().platform().deps, ctx);
  } catch {
    org = null;
  }
  const tabs = [
    { href: "/app", label: "Traces" },
    { href: "/app/packs", label: "Evidence packs" },
    { href: "/app/marketplace", label: "Marketplace" },
    { href: "/app/map", label: "Supply-chain map" },
    { href: "/app/listings", label: "My listings" },
  ];
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold">{org ? org.name : "Your dashboard"}</h1>
          <p className="text-sm text-muted">
            {org ? `Roles: ${org.roles.join(" + ")}${org.isOrgAdmin ? " · org admin" : ""}` : ctx.role === "admin" ? "Lodeline staff view" : "No company account yet"}
          </p>
        </div>
      </header>
      {!org && ctx.role !== "admin" ? <OrgSetup /> : null}
      <DashboardTabs tabs={tabs} />
      <div>{children}</div>
    </div>
  );
}
