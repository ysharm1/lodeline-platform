/** First step for a new customer: name the company (creates the org and the admin membership). */
export function OrgSetup() {
  return (
    <form action="/api/org" method="post" className="rounded border border-accent/60 bg-ink-2 p-4 space-y-2 text-sm" data-testid="org-setup">
      <p className="font-medium">Set up your company account</p>
      <p className="text-muted">Your traces, evidence packs, intro requests and listings belong to your company. You can be a buyer and, later, a seller.</p>
      <div className="flex gap-2">
        <input name="name" required minLength={2} maxLength={200} placeholder="Company name" className="flex-1 rounded border border-line bg-ink px-3 py-1.5" />
        <button className="rounded bg-paper text-ink px-3 py-1.5 font-medium">Create account</button>
      </div>
    </form>
  );
}
