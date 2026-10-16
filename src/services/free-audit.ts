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
import { keywordClassify } from "./keyword-classifier";
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
      const items = parts.map((p, i) => ({ id: String(i), description: p.description, partNumber: p.partNumber }));
      const classified = new Map<string, { materials: AuditPartRecord["materials"]; confidence: number; rationale: string }>();
      let model = "keyword-fallback";
      try {
        for (let i = 0; i < items.length; i += BATCH) {
          const r = await this.d.llm.classifyParts(items.slice(i, i + BATCH));
          model = r.model;
          for (const x of r.results) classified.set(x.id, x);
        }
      } catch (e) {
        if (!(e instanceof LlmGuardError) || this.d.requireLlm) throw e;
        // LLM not permitted: deterministic keywords only; nothing leaves the box.
        for (const it of items) classified.set(it.id, keywordClassify(`${it.partNumber ?? ""} ${it.description}`));
      }

      const rows: AuditPartRecord[] = parts.map((p, i) => {
        const c = classified.get(String(i)) ?? keywordClassify(p.description);
        return {
          id: randomUUID(),
          auditId: id,
          rowIndex: p.rowIndex,
          partNumber: p.partNumber,
          description: p.description,
          supplierName: p.supplierName,
          quantity: p.quantity,
          materials: c.materials,
          llmConfidence: c.confidence,
          llmRationale: c.rationale,
          undocumentedStages: undocumentedStages(c.materials),
          ruleVersion: RULE_VERSION,
        };
      });
      await this.d.repo.createAuditParts(rows);
      await this.d.repo.updateAudit(id, { status: "classified", llmModel: model, promptVersion: PROMPT_VERSION });
      await this.d.audit.append({
        action: "audit.classified",
        subjectId: id,
        payload: { model, promptVersion: PROMPT_VERSION, ruleVersion: RULE_VERSION, flagged: rows.filter((r) => r.undocumentedStages.length).length },
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
    const flagged = parts.filter((p) => p.undocumentedStages.length > 0);
    return { audit, parts, summary: { total: parts.length, flagged: flagged.length } };
  }
}
