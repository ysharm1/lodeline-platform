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
          <a href="/" className="flex items-center gap-2 font-semibold tracking-tight text-lg">
            <img src="/assets/mark.svg" alt="" width={26} height={26} />
            Lodeline
          </a>
          <nav className="flex gap-4 text-sm text-muted">
            {!ctx ? (
              <>
                <Link href="/demo" className="hover:text-paper">Demo</Link>
                <Link href="/audit" className="hover:text-paper">Free parts audit</Link>
                <Link href="/suppliers" className="hover:text-paper">Supplier directory</Link>
                <Link href="/pack" className="hover:text-paper">Evidence pack</Link>
              </>
            ) : null}
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
            Never upload drawings, controlled technical data or export-controlled (ITAR/CUI) information.
          </p>
          <p className="text-xs text-muted">
            <a href="mailto:info@lodeline.org" className="underline">info@lodeline.org</a> · Yash Sharma{" "}
            <a href="tel:+16023159861" className="underline">(602) 315-9861</a> · <a href="/for-suppliers" className="underline">For suppliers</a> ·{" "}
            <a href="/privacy" className="underline">Privacy</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
