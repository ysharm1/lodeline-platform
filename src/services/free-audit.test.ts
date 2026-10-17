import { describe, expect, it, vi } from "vitest";
import { LlmClient } from "@/infra/llm";
import { InMemoryRepository } from "@/repository/in-memory";
import { AuditService } from "./audit";
import { FreeAuditService, mergeLlm } from "./free-audit";
import { classifyPart } from "./keyword-classifier";
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

describe("free audit: rules first, LLM only for uncertain rows", () => {
  const bom = new TextEncoder().encode(
    [
      "Part Number,MPN,Description,Material,Manufacturer,Notes,Qty",
      "P1,T491A106K016AT,CAP 10UF 16V,,KEMET,,10",
      "P2,,SPEAKER 45MM 6W,,PUI Audio,,5",
      "P3,,ENCLOSURE DIECAST ALUM,AL,Hammond,,2",
      "P4,F83208,MAGNET CERAMIC GR8,FERRITE,MagnetShop,,1",
      "P5,,Rotor assy,,Acme,magnets NdFeB per spec,1",
    ].join("\n")
  );

  function live(content: unknown) {
    const repo = new InMemoryRepository();
    const fetchImpl = vi.fn(async (_u: string, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 }));
    const svc = new FreeAuditService({
      repo,
      storage: new MemoryDocumentStorage(),
      audit: new AuditService(repo),
      llm: new LlmClient({ zdrConfirmed: true, apiKey: "k", model: "test-model", provider: "p", baseUrl: "https://x.invalid" }, () => {}, fetchImpl as unknown as typeof fetch),
    });
    return { svc, fetchImpl, repo };
  }

  it("without a key: rules only, three categories with cited reasons, flagged = likely + possible", async () => {
    const { svc } = setup(true);
    const { auditId, accessToken } = await svc.run({ fileName: "bom.csv", bytes: bom, leadEmail: "a@b.co" });
    const r = await svc.results(auditId, accessToken);
    expect(r.parts.map((p) => p.coverage)).toEqual(["likely", "possible", "not_likely", "not_likely", "likely"]);
    expect(r.coverage).toEqual({ likely: 2, possible: 1, notLikely: 2 });
    expect(r.summary).toEqual({ total: 5, flagged: 3 });
    expect(r.parts[0]).toMatchObject({ mpn: "T491A106K016AT", manufacturer: "KEMET", materials: ["tantalum"], classifiedBy: "table" });
    expect(r.parts[0].reason).toContain("kemet.t49x");
    expect(r.parts[1].undocumentedStages).toEqual([]); // magnet type unknown: no stages until confirmed
    expect(r.parts[3].reason).toMatch(/ferrite/i);
    expect(r.parts[4].reason).toContain("Notes");
    expect(r.parts.every((p) => p.reason.length > 0)).toBe(true);
  });

  it("with a key: sends only uncertain rows, with MPN, manufacturer and every column", async () => {
    const { svc, fetchImpl } = live({ results: [{ id: "1", coverage: "likely", materials: ["ndfeb"], confidence: 0.9, rationale: "series uses Nd-Fe-B" }] });
    const { auditId, accessToken } = await svc.run({ fileName: "bom.csv", bytes: bom, leadEmail: "a@b.co" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(JSON.parse(fetchImpl.mock.calls[0][1].body as string).messages[1].content);
    expect(sent.map((x: { id: string }) => x.id)).toEqual(["1", "2"]); // speaker (possible) + enclosure (no signal); not the KEMET cap, ferrite or NdFeB rows
    expect(sent[0]).toMatchObject({ pn: "P2", mfr: "PUI Audio", d: "SPEAKER 45MM 6W" });
    expect(sent[1]).toMatchObject({ mat: "AL", mfr: "Hammond" });
    expect(sent[0].rule).toMatch(/^possible:/);
    const r = await svc.results(auditId, accessToken);
    expect(r.audit.llmModel).toBe("rules-v2+test-model");
    expect(r.parts[1]).toMatchObject({ coverage: "likely", materials: ["ndfeb"], classifiedBy: "llm" });
    expect(r.parts[2].coverage).toBe("not_likely");
  });

  it("with a key but nothing uncertain, the LLM is not called", async () => {
    const { svc, fetchImpl } = live({ results: [] });
    await svc.run({ fileName: "b.csv", bytes: new TextEncoder().encode("Description\nCAP TANT 10UF\nFerrite ring magnet\n"), leadEmail: "a@b.co" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requireLlm with the guard closed is a hard error", async () => {
    const repo = new InMemoryRepository();
    const svc = new FreeAuditService({ repo, storage: new MemoryDocumentStorage(), audit: new AuditService(repo), requireLlm: true, llm: new LlmClient({ zdrConfirmed: false, apiKey: "k", model: "m", provider: "p", baseUrl: "x" }, () => {}) });
    await expect(svc.run({ fileName: "bom.csv", bytes: csv, leadEmail: "a@b.co" })).rejects.toMatchObject({ code: "LLM_ZDR_NOT_CONFIRMED" });
  });

  it("the LLM can upgrade but never clears a rule-flagged 'possible' row", () => {
    const possible = classifyPart({ description: "SPEAKER 45MM" });
    expect(mergeLlm(possible, { coverage: "not_likely", materials: ["other"], confidence: 0.95, rationale: "probably ferrite" }, "m").coverage).toBe("possible");
    expect(mergeLlm(possible, { coverage: "likely", materials: ["ndfeb"], confidence: 0.6, rationale: "maybe" }, "m").coverage).toBe("possible");
    const none = classifyPart({ description: "Bracket" });
    expect(mergeLlm(none, { coverage: "possible", materials: ["tungsten"], confidence: 0.5, rationale: "could be WHA" }, "m")).toMatchObject({ coverage: "possible", materials: ["tungsten"] });
  });
});
