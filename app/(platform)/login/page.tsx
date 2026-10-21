export default async function Login({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string; next?: string }> }) {
  const { sent, error, next } = await searchParams;
  return (
    <div className="max-w-md space-y-5">
      <h1 className="text-2xl font-semibold">Sign in or create an account</h1>
      <p className="text-sm text-muted">New here? Enter your work email. The link creates your account; you then name your company on the dashboard.</p>
      {sent ? (
        <p className="text-sm">If that address can sign in, a link is on its way. It expires in 15 minutes.</p>
      ) : (
        <form action="/api/auth/magic-link" method="post" className="space-y-3">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <input name="email" type="email" required placeholder="you@company.com" className="w-full rounded border border-line bg-ink-2 px-3 py-2" />
          <button className="rounded bg-paper text-ink px-4 py-2 font-medium">Email me a sign-in link</button>
        </form>
      )}
      {error ? <p className="text-sm text-gap">That sign-in link is invalid or expired. Request a new one.</p> : null}
    </div>
  );
}
