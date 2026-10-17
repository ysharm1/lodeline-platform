/**
 * Free parts audit, end to end:
 * upload -> file gate (rejects drawings) -> parse -> classify (LLM wrapper,
 * keyword fallback) -> deterministic stage rules -> persisted results.
 *
 * Results are reachable only with the audit's access token (sent back to the
 * uploader and, later, emailed). Only the token's hash is stored.
 */
import { createHash, randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "@/domain/errors";
import type { AuditPartRecord, PartsAuditRecord } from "@/domain/types";
import { LlmGuardError, PROMPT_VERSION, type LlmClient } from "@/infra/llm";
import { generateSessionToken, hashSessionToken } from "@/session/store";
import type { AuditService } from "./audit";
import { CLASSIFIER_VERSION, classifyPart, type PartClassification } from "./keyword-classifier";
import { normalizeEmail } from "./magic-link";
import { detectPartsFileKind, parsePartsFile } from "./parts-parser";
import { RULE_VERSION, undocumentedStages } from "./stage-rules";
import type { DocumentStorage } from "./storage";

export interface FreeAuditRepository {
  createAudit(a: PartsAuditRecord): Promise<void>;
  updateAudit(id: string, patch: Partial<PartsAuditRecord>): Promise<void>;
  findAudit(id: string): Promise<PartsAuditRecord | null>;
  createAuditParts(parts: AuditPartRecord[]): Promise<void>;
  listAuditParts(auditId: string): Promise<AuditPartRecord[]>;
}

export interface FreeAuditInput {
  fileName: string;
  bytes: Uint8Array;
  leadEmail: unknown;
  companyName?: unknown;
  ip?: string | null;
  actorUserId?: string | null;
}

const BATCH = 50;

export class FreeAuditService {
  constructor(
    private readonly d: {
      repo: FreeAuditRepository;
      storage: DocumentStorage;
      llm: LlmClient;
      audit: AuditService;
      now?: () => Date;
      /** In production a disabled LLM is a hard error; in dev it falls back. */
      requireLlm?: boolean;
    }
  ) {}

  async run(input: FreeAuditInput): Promise<{ auditId: string; accessToken: string }> {
    const now = this.d.now?.() ?? new Date();
    const leadEmail = normalizeEmail(input.leadEmail);
    const companyName =
      typeof input.companyName === "string" && input.companyName.trim() ? input.companyName.trim().slice(0, 200) : null;
    const fileName = input.fileName.replace(/[^\w.\- ]/g, "_").slice(0, 200);
    if (!fileName) throw new ValidationError("FILE_NAME_INVALID", "File name is invalid.", "file");

    const kind = detectPartsFileKind(fileName, input.bytes); // throws on drawings
    const parts = await parsePartsFile(fileName, input.bytes);

    const id = randomUUID();
    const accessToken = generateSessionToken();
    const sha = createHash("sha256").update(input.bytes).digest("hex");
    const key = await this.d.storage.put({
      key: `audits/${id}/source.${kind}`,
      body: input.bytes,
      contentType: kind === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await this.d.repo.createAudit({
      id,
      orgId: null,
      leadEmail,
      companyName,
      sourceFileKey: key,
      sourceFileName: fileName,
      sourceSha256: sha,
      rowCount: parts.length,
      status: "parsing",
      llmModel: null,
      promptVersion: null,
      accessTokenHash: hashSessionToken(accessToken),
      createdAt: now,
    });
    await this.d.audit.append({
      action: "audit.created",
      actorUserId: input.actorUserId ?? null,
      subjectId: id,
      payload: { rowCount: parts.length, sha256: sha, kind },
      ip: input.ip ?? null,
    });

    try {
      // 1) Deterministic rules + verified manufacturer/MPN patterns, on every column we mapped.
      const ruled = parts.map((p) => classifyPart(p));
      type Final = { coverage: AuditPartRecord["coverage"]; materials: AuditPartRecord["materials"]; confidence: number; reason: string; classifiedBy: string; llmRationale: string | null };
      const final: Final[] = ruled.map((c) => ({ coverage: c.coverage, materials: c.materials, confidence: c.confidence, reason: c.reason, classifiedBy: c.classifiedBy, llmRationale: null }));

      // 2) LLM only for rows that stay uncertain, behind the llm.ts guard. No key => skipped.
      let model = "keyword-mock";
      const availability = this.d.llm.availability();
      if (availability === "blocked") {
        if (this.d.requireLlm) throw new LlmGuardError();
        model = "keyword-fallback"; // LLM not permitted: rules only; nothing leaves the box.
      } else if (availability === "live") {
        model = `${CLASSIFIER_VERSION}+${this.d.llm.modelName}`;
        const uncertain = parts.map((p, i) => ({ p, i })).filter(({ i }) => ruled[i].uncertain);
        for (let b = 0; b < uncertain.length; b += BATCH) {
          const chunk = uncertain.slice(b, b + BATCH);
          const r = await this.d.llm.classifyParts(
            chunk.map(({ p, i }) => ({
              id: String(i),
              description: p.description,
              partNumber: p.partNumber,
              mpn: p.mpn,
              manufacturer: p.manufacturer,
              supplierName: p.supplierName,
              material: p.material,
              notes: p.notes,
              ruleHint: `${ruled[i].coverage}: ${ruled[i].reason}`.slice(0, 300),
            }))
          );
          if (r.mode !== "llm") continue;
          for (const x of r.results) {
            const i = Number(x.id);
            if (!Number.isInteger(i) || !ruled[i]?.uncertain) continue;
            final[i] = mergeLlm(ruled[i], x, r.model);
          }
        }
      }

      const rows: AuditPartRecord[] = parts.map((p, i) => {
        const c = final[i];
        return {
          id: randomUUID(),
          auditId: id,
          rowIndex: p.rowIndex,
          partNumber: p.partNumber,
          description: p.description,
          supplierName: p.supplierName,
          quantity: p.quantity,
          mpn: p.mpn,
          manufacturer: p.manufacturer,
          material: p.material,
          notes: p.notes,
          materials: c.materials,
          coverage: c.coverage,
          reason: c.reason,
          classifiedBy: c.classifiedBy,
          llmConfidence: c.confidence,
          llmRationale: c.llmRationale,
          undocumentedStages: c.coverage === "not_likely" ? [] : undocumentedStages(c.materials),
          ruleVersion: `${RULE_VERSION}/${CLASSIFIER_VERSION}`,
        };
      });
      await this.d.repo.createAuditParts(rows);
      await this.d.repo.updateAudit(id, { status: "classified", llmModel: model, promptVersion: PROMPT_VERSION });
      await this.d.audit.append({
        action: "audit.classified",
        subjectId: id,
        payload: { model, promptVersion: PROMPT_VERSION, ruleVersion: `${RULE_VERSION}/${CLASSIFIER_VERSION}`, ...coverageCounts(rows) },
      });
    } catch (e) {
      await this.d.repo.updateAudit(id, { status: "failed" });
      await this.d.audit.append({ action: "audit.failed", subjectId: id, payload: { code: (e as { code?: string }).code ?? "ERROR" } });
      throw e;
    }
    return { auditId: id, accessToken };
  }

  async results(auditId: string, accessToken: string | null | undefined) {
    const audit = await this.d.repo.findAudit(auditId);
    if (!audit || !accessToken || audit.accessTokenHash !== hashSessionToken(accessToken)) {
      throw new NotFoundError("AUDIT_NOT_FOUND", "Audit not found.");
    }
    const parts = await this.d.repo.listAuditParts(auditId);
    const counts = coverageCounts(parts);
    return { audit, parts, summary: { total: parts.length, flagged: counts.likely + counts.possible }, coverage: counts };
  }
}

/** likely + possible both count as "flagged": a possible row needs a supplier answer, it is never cleared. */
export function coverageCounts(parts: Pick<AuditPartRecord, "coverage">[]): { likely: number; possible: number; notLikely: number } {
  return {
    likely: parts.filter((p) => p.coverage === "likely").length,
    possible: parts.filter((p) => p.coverage === "possible").length,
    notLikely: parts.filter((p) => p.coverage === "not_likely").length,
  };
}

/**
 * Merge an LLM answer into an uncertain rule result. The LLM may upgrade a row
 * (possible -> likely with confidence >= 0.8, or a no-signal row to possible/likely)
 * but may never clear a row that a rule marked possible.
 */
export function mergeLlm(
  rule: PartClassification,
  x: { coverage?: AuditPartRecord["coverage"]; materials: AuditPartRecord["materials"]; confidence: number; rationale: string },
  model: string
): { coverage: AuditPartRecord["coverage"]; materials: AuditPartRecord["materials"]; confidence: number; reason: string; classifiedBy: string; llmRationale: string } {
  const covered = x.materials.filter((m) => m !== "other");
  const llmCov = x.coverage ?? (covered.length ? (x.confidence >= 0.8 ? "likely" : "possible") : "not_likely");
  const note = `LLM (${model}): ${x.rationale}`;
  if (llmCov === "likely" && covered.length && x.confidence >= 0.8) {
    return { coverage: "likely", materials: covered, confidence: x.confidence, reason: `Likely (LLM review): ${x.rationale}. Rules: ${rule.reason}`, classifiedBy: "llm", llmRationale: note };
  }
  if (llmCov !== "not_likely" && covered.length) {
    return { coverage: "possible", materials: covered, confidence: Math.min(x.confidence, 0.79), reason: `Confirm with supplier (LLM review): ${x.rationale}. Rules: ${rule.reason}`, classifiedBy: "llm", llmRationale: note };
  }
  // LLM says not covered: keep a rule "possible" as possible; a no-signal row stays not_likely with the LLM note.
  return { coverage: rule.coverage, materials: rule.materials, confidence: rule.confidence, reason: `${rule.reason} LLM review: ${x.rationale}.`, classifiedBy: rule.classifiedBy, llmRationale: note };
}
