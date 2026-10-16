import type { PackService } from "./packs";
import type { PackPdfData } from "./pack-pdf";

/** Assemble PDF input strictly from DB state (accepted claims only). */
export async function loadPackPdfData(packs: PackService, packId: string, now = new Date()): Promise<PackPdfData> {
  const { pack, matrix, accepted, requests } = await packs.view(packId);
  const supplierForPart: Record<string, string> = {};
  for (const r of requests) if (!r.revokedAt) for (const pid of r.partIds) supplierForPart[pid] ??= r.supplier.name;
  const docIds = new Set(accepted.map((c) => c.documentId));
  const documents = requests.flatMap((r) =>
    r.documents.filter((d) => docIds.has(d.id)).map((d) => ({ id: d.id, fileName: d.fileName, sha256: d.sha256, supplierName: r.supplier.name, uploadedAt: d.uploadedAt, pageCount: d.pageCount }))
  );
  return {
    packId: pack.id,
    orgName: pack.org.name,
    generatedAt: now,
    sourceFileName: pack.audit.sourceFileName,
    matrix,
    supplierForPart,
    documents,
    claims: accepted.map((c) => ({
      id: c.id,
      stage: c.stage,
      facilityName: c.facilityName,
      address: c.address,
      country: c.country,
      countryIso: c.countryIso,
      latitude: c.latitude,
      longitude: c.longitude,
      coveredCountry: c.coveredCountry,
      issuer: c.issuer,
      issueDate: c.issueDate,
      documentId: c.documentId,
      supplierName: c.supplier.name,
      citations: (c.citations as { field: string; page: number; quote: string }[]) ?? [],
    })),
  };
}
