import { describe, expect, it } from "vitest";
import { LlmClient } from "@/infra/llm";
import { InMemoryRepository } from "@/repository/in-memory";
import { AuditService } from "./audit";
import { FreeAuditService } from "./free-audit";
import { MemoryDocumentStorage } from "./storage";

const csv = new TextEncoder().encode("Part Number,Description,Supplier\nM-1,BLDC motor,Acme\nB-2,Hex bolt,Fastco\nT-3,Tungsten ballast weight,Wco\n");

function setup(zdr: boolean) {
  const repo = new InMemoryRepository();
  const storage = new MemoryDocumentStorage();
  const svc = new FreeAuditService({
    repo,
    storage,
    audit: new AuditService(repo),
    llm: new LlmClient({ zdrConfirmed: zdr, model: "m", provider: "p", baseUrl: "https://x.invalid" }, () => {}),
  });
  return { repo, storage, svc };
}

describe("free audit end to end", () => {
  it("parses, classifies, applies rules, stores source, audits writes", async () => {
    const { repo, storage, svc } = setup(true);
    const { auditId, accessToken } = await svc.run({ fileName: "bom.csv", bytes: csv, leadEmail: "a@b.co" });
    const r = await svc.results(auditId, accessToken);
    expect(r.audit.status).toBe("classified");
    expect(r.audit.llmModel).toBe("keyword-mock");
    expect(r.summary).toEqual({ total: 3, flagged: 2 });
    expect(r.parts[0].undocumentedStages).toEqual(["mine", "separation", "metal_alloy", "magnet"]);
    expect(r.parts[1].undocumentedStages).toEqual([]);
    expect(storage.objects.has(`audits/${auditId}/source.csv`)).toBe(true);
    expect(repo.entries.map((e) => e.action)).toEqual(["audit.created", "audit.classified"]);
    expect(JSON.stringify(repo.entries)).not.toMatch(/motor|bolt/i);
  });

  it("falls back to keywords when ZDR is not confirmed", async () => {
    const { svc } = setup(false);
    const { auditId, accessToken } = await svc.run({ fileName: "bom.csv", bytes: csv, leadEmail: "a@b.co" });
    expect((await svc.results(auditId, accessToken)).audit.llmModel).toBe("keyword-fallback");
  });

  it("requires the access token", async () => {
    const { svc } = setup(true);
    const { auditId } = await svc.run({ fileName: "bom.csv", bytes: csv, leadEmail: "a@b.co" });
    await expect(svc.results(auditId, "wrong")).rejects.toMatchObject({ code: "AUDIT_NOT_FOUND" });
  });

  it("rejects drawings before storing anything", async () => {
    const { svc, storage, repo } = setup(true);
    await expect(svc.run({ fileName: "rotor.dwg", bytes: csv, leadEmail: "a@b.co" })).rejects.toMatchObject({ code: "DRAWING_REJECTED" });
    expect(storage.objects.size).toBe(0);
    expect(repo.audits.size).toBe(0);
  });
});
