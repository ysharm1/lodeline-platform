/** In-memory Repository for tests and DB-less local dev. */
import { randomUUID } from "node:crypto";
import type { AuditEntryRecord, AuditPartRecord, MagicLinkRecord, PartsAuditRecord, User } from "@/domain/types";
import type { Repository } from "./repository";

export class InMemoryRepository implements Repository {
  users = new Map<string, User>();
  links = new Map<string, MagicLinkRecord>();
  audits = new Map<string, PartsAuditRecord>();
  parts: AuditPartRecord[] = [];
  entries: AuditEntryRecord[] = [];

  async appendAuditEntry(e: Omit<AuditEntryRecord, "id">) {
    const row = { ...e, id: randomUUID() };
    this.entries.push(row);
    return { ...row };
  }
  async listAuditEntries(limit: number) {
    return [...this.entries].reverse().slice(0, limit);
  }
  async listAuditEntriesBySubject(subjectId: string) {
    return this.entries.filter((e) => e.subjectId === subjectId);
  }
  async createAudit(a: PartsAuditRecord) {
    this.audits.set(a.id, { ...a });
  }
  async updateAudit(id: string, patch: Partial<PartsAuditRecord>) {
    const a = this.audits.get(id);
    if (a) this.audits.set(id, { ...a, ...patch });
  }
  async findAudit(id: string) {
    const a = this.audits.get(id);
    return a ? { ...a } : null;
  }
  async createAuditParts(parts: AuditPartRecord[]) {
    this.parts.push(...parts.map((p) => ({ ...p })));
  }
  async listAuditParts(auditId: string) {
    return this.parts.filter((p) => p.auditId === auditId).sort((a, b) => a.rowIndex - b.rowIndex);
  }
  async createMagicLink(r: MagicLinkRecord) {
    this.links.set(r.id, { ...r });
  }
  async findMagicLinkByHash(h: string) {
    for (const l of this.links.values()) if (l.tokenHash === h) return { ...l };
    return null;
  }
  async markMagicLinkUsed(id: string, at: Date) {
    const l = this.links.get(id);
    if (!l || l.usedAt) return false;
    l.usedAt = at;
    return true;
  }
  async findUserByEmail(email: string) {
    for (const u of this.users.values()) if (u.email === email) return { ...u };
    return null;
  }
  async findUserById(id: string) {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }
  async createUser(u: User) {
    this.users.set(u.id, { ...u });
    return { ...u };
  }
  async markEmailVerified(userId: string, at: Date) {
    const u = this.users.get(userId);
    if (u) u.emailVerifiedAt = at;
  }
}
