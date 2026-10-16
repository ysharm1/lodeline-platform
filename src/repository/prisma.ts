/** Prisma/Postgres Repository. */
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuditEntryRecord, AuditPartRecord, MagicLinkRecord, PartsAuditRecord, User } from "@/domain/types";
import type { Repository } from "./repository";

type PartRow = Prisma.AuditPartGetPayload<object>;
const toPart = (p: PartRow): AuditPartRecord => ({ ...p, quantity: p.quantity === null ? null : Number(p.quantity) });
const toEntry = (e: Prisma.AuditEntryGetPayload<object>): AuditEntryRecord => ({
  ...e,
  payload: (e.payload ?? {}) as Record<string, unknown>,
});

export class PrismaRepository implements Repository {
  constructor(private readonly db: PrismaClient) {}

  async appendAuditEntry(e: Omit<AuditEntryRecord, "id">) {
    return toEntry(await this.db.auditEntry.create({ data: { ...e, payload: e.payload as Prisma.InputJsonValue } }));
  }
  async listAuditEntries(limit: number) {
    return (await this.db.auditEntry.findMany({ orderBy: { createdAt: "desc" }, take: limit })).map(toEntry);
  }
  async listAuditEntriesBySubject(subjectId: string) {
    return (await this.db.auditEntry.findMany({ where: { subjectId }, orderBy: { createdAt: "asc" } })).map(toEntry);
  }
  async createAudit(a: PartsAuditRecord) {
    await this.db.partsAudit.create({ data: a });
  }
  async updateAudit(id: string, patch: Partial<PartsAuditRecord>) {
    await this.db.partsAudit.update({ where: { id }, data: patch });
  }
  async findAudit(id: string) {
    return this.db.partsAudit.findUnique({ where: { id } });
  }
  async createAuditParts(parts: AuditPartRecord[]) {
    await this.db.auditPart.createMany({ data: parts.map((p) => ({ ...p, quantity: p.quantity ?? undefined })) });
  }
  async listAuditParts(auditId: string) {
    return (await this.db.auditPart.findMany({ where: { auditId }, orderBy: { rowIndex: "asc" } })).map(toPart);
  }
  async createMagicLink(r: MagicLinkRecord) {
    await this.db.magicLink.create({ data: r });
  }
  async findMagicLinkByHash(tokenHash: string) {
    return this.db.magicLink.findUnique({ where: { tokenHash } });
  }
  async markMagicLinkUsed(id: string, usedAt: Date) {
    const r = await this.db.magicLink.updateMany({ where: { id, usedAt: null }, data: { usedAt } });
    return r.count === 1;
  }
  async findUserByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } }) as Promise<User | null>;
  }
  async findUserById(id: string) {
    return this.db.user.findUnique({ where: { id } }) as Promise<User | null>;
  }
  async createUser(u: User) {
    return (await this.db.user.create({ data: u })) as User;
  }
  async markEmailVerified(userId: string, at: Date) {
    await this.db.user.update({ where: { id: userId }, data: { emailVerifiedAt: at } });
  }
}
