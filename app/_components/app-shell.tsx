import Link from "next/link";
import { getAuthContext } from "@/http/auth-context";
import { navigationFor } from "@/services/authorization";
import { Disclaimer } from "./disclaimer";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext();
  const nav = ctx ? navigationFor(ctx.role) : [];
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center gap-6">
          <Link href="/" className="font-semibold tracking-tight text-lg">
            Lodeline
          </Link>
          <nav className="flex gap-4 text-sm text-muted">
            <Link href="/audit" className="hover:text-paper">Free parts audit</Link>
            {nav.map((n) => (
              <Link key={n.id} href={n.path} className="hover:text-paper">{n.label}</Link>
            ))}
          </nav>
          <div className="ml-auto text-sm text-muted">
            {ctx ? (
              <form action="/api/auth/logout" method="post" className="flex items-center gap-3">
                <span>{ctx.email}</span>
                <button className="underline hover:text-paper">Sign out</button>
              </form>
            ) : (
              <Link href="/login" className="hover:text-paper">Sign in</Link>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-10">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-6 space-y-2">
          <Disclaimer />
          <p className="text-xs text-muted">
            Never upload drawings, controlled technical data or export-controlled (ITAR/CUI) information. Contact: info@lodeline.org
          </p>
        </div>
      </footer>
    </div>
  );
}
