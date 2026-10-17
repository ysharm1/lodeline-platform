export function Stub({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted">Not built yet (planned for a later MVP week).</p>
      {children}
    </section>
  );
}
