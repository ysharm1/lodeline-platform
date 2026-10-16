export default async function Login({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  return (
    <div className="max-w-md space-y-5">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {sent ? (
        <p className="text-sm">If that address can sign in, a link is on its way. It expires in 15 minutes.</p>
      ) : (
        <form action="/api/auth/magic-link" method="post" className="space-y-3">
          <input name="email" type="email" required placeholder="you@company.com" className="w-full rounded border border-line bg-ink-2 px-3 py-2" />
          <button className="rounded bg-paper text-ink px-4 py-2 font-medium">Email me a sign-in link</button>
        </form>
      )}
      {error ? <p className="text-sm text-gap">That sign-in link is invalid or expired. Request a new one.</p> : null}
    </div>
  );
}
