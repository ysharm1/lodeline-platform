import type { AuthContext } from "@/domain/types";
import { container } from "@/composition/root";
import type { MatrixRow } from "@/services/pack-matrix";

export const LIVE_TRACE_DEMO_URL = "https://lodeline-trace-demo.vercel.app/try";

export interface TraceSummary {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  paid: boolean;
  parts: number;
  cells: number;
  documented: number;
  coveredCountry: number;
  matrix: MatrixRow[];
}

/** The org's evidence packs as traces, with stage coverage counts. */
export async function loadTraces(ctx: AuthContext): Promise<{ traces: TraceSummary[]; unavailable: boolean }> {
  try {
    const p = container().platform();
    const packs = await p.packs.listForBuyer(ctx);
    const traces: TraceSummary[] = [];
    for (const pk of packs.slice(0, 50)) {
      const { matrix } = await p.packs.view(pk.id);
      const cells = matrix.flatMap((r) => r.cells);
      traces.push({
        id: pk.id,
        name: pk.audit.sourceFileName,
        status: pk.status,
        createdAt: pk.createdAt,
        paid: !!pk.paidAt,
        parts: matrix.length,
        cells: cells.length,
        documented: cells.filter((c) => c.status === "documented").length,
        coveredCountry: cells.filter((c) => c.status === "covered_country").length,
        matrix,
      });
    }
    return { traces, unavailable: false };
  } catch {
    return { traces: [], unavailable: true };
  }
}
