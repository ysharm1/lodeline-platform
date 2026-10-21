"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface Tab { href: string; label: string }

/** Dashboard tabs: Traces | Evidence packs | Marketplace | Supply-chain map | My listings. */
export function DashboardTabs({ tabs }: { tabs: Tab[] }) {
  const path = usePathname();
  const active = (href: string) => (href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`));
  return (
    <nav className="flex flex-wrap gap-1 border-b border-line text-sm" data-testid="dashboard-tabs">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active(t.href) ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 ${active(t.href) ? "border-accent text-paper" : "border-transparent text-muted hover:text-paper"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
