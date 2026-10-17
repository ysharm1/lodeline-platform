import { container } from "@/composition/root";
import { requirePageRole } from "../../_lib/guard";
export const dynamic = "force-dynamic";
export default async function AuditLog() {
  await requirePageRole("admin");
  const entries = await container().audit.list(200);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-muted"><tr><th>When (UTC)</th><th>Action</th><th>Actor</th><th>Subject</th><th>Payload</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-line align-top">
              <td className="py-2 font-mono text-xs">{e.createdAt.toISOString()}</td>
              <td>{e.action}</td>
              <td className="font-mono text-xs">{e.actorUserId?.slice(0, 8) ?? "-"}</td>
              <td className="font-mono text-xs">{e.subjectId.slice(0, 8)}</td>
              <td className="font-mono text-xs">{JSON.stringify(e.payload)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
