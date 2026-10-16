/**
 * Email magic-link login.
 *
 * - The raw token only ever exists in the emailed URL; the DB stores SHA-256.
 * - Links are single-use and expire after MAGIC_LINK_TTL_MINUTES (15).
 * - Requesting a link never reveals whether an account exists.
 * - Consuming a link creates the user on first sign-in (role buyer) and
 *   issues a server-side session (hashed token, LoadEnergy pattern).
 */
import { randomUUID } from "node:crypto";
import { AuthenticationError, ValidationError } from "@/domain/errors";
import type { MagicLinkRecord, Role, User } from "@/domain/types";
import {
  generateSessionToken,
  hashSessionToken,
  type SessionStore,
} from "@/session/store";
import type { EmailSender } from "./notifications";

export const MAGIC_LINK_TTL_MINUTES = 15;
export const SESSION_TTL_DAYS = 14;

export interface MagicLinkRepository {
  createMagicLink(r: MagicLinkRecord): Promise<void>;
  findMagicLinkByHash(tokenHash: string): Promise<MagicLinkRecord | null>;
  /** Atomically marks used; returns false if it was already used. */
  markMagicLinkUsed(id: string, usedAt: Date): Promise<boolean>;
  findUserByEmail(email: string): Promise<User | null>;
  createUser(u: User): Promise<User>;
  markEmailVerified(userId: string, at: Date): Promise<void>;
}

/** Only same-site relative paths ("/x"), never "//host" or "/\\host". */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== "string" || next.length > 500) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") throw new ValidationError("EMAIL_INVALID", "Enter a valid email.", "email");
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new ValidationError("EMAIL_INVALID", "Enter a valid email.", "email");
  }
  return email;
}

export interface MagicLinkDeps {
  repo: MagicLinkRepository;
  sessions: SessionStore;
  email: EmailSender;
  baseUrl: string;
  now?: () => Date;
  /** Emails that become admin on first sign-in (SEED_ADMIN_EMAIL). */
  adminEmails?: string[];
}

export class MagicLinkService {
  private readonly now: () => Date;
  constructor(private readonly d: MagicLinkDeps) {
    this.now = d.now ?? (() => new Date());
  }

  /** Returns the link id (for auditing). Never returns the token. */
  async request(rawEmail: unknown, next?: unknown): Promise<{ id: string; email: string }> {
    const email = normalizeEmail(rawEmail);
    const token = generateSessionToken();
    const now = this.now();
    const record: MagicLinkRecord = {
      id: randomUUID(),
      email,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MINUTES * 60_000),
      usedAt: null,
      createdAt: now,
    };
    await this.d.repo.createMagicLink(record);
    const safeNext = safeNextPath(next);
    const url = `${this.d.baseUrl.replace(/\/$/, "")}/api/auth/callback?token=${encodeURIComponent(token)}${safeNext ? `&next=${encodeURIComponent(safeNext)}` : ""}`;
    await this.d.email.send({
      to: email,
      subject: "Your Lodeline sign-in link",
      text:
        `Sign in to Lodeline:\n\n${url}\n\n` +
        `This link expires in ${MAGIC_LINK_TTL_MINUTES} minutes and works once.\n` +
        `If you did not request it, ignore this email.`,
    });
    return { id: record.id, email };
  }

  async consume(token: unknown): Promise<{ sessionToken: string; user: User; expiresAt: Date }> {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) {
      throw new AuthenticationError("MAGIC_LINK_INVALID", "This sign-in link is invalid.");
    }
    const now = this.now();
    const link = await this.d.repo.findMagicLinkByHash(hashSessionToken(token));
    if (!link) throw new AuthenticationError("MAGIC_LINK_INVALID", "This sign-in link is invalid.");
    if (link.usedAt) throw new AuthenticationError("MAGIC_LINK_USED", "This sign-in link was already used.");
    if (now >= link.expiresAt) throw new AuthenticationError("MAGIC_LINK_EXPIRED", "This sign-in link has expired.");
    const claimed = await this.d.repo.markMagicLinkUsed(link.id, now);
    if (!claimed) throw new AuthenticationError("MAGIC_LINK_USED", "This sign-in link was already used.");

    let user = await this.d.repo.findUserByEmail(link.email);
    if (!user) {
      const role: Role = (this.d.adminEmails ?? []).includes(link.email) ? "admin" : "buyer";
      user = await this.d.repo.createUser({
        id: randomUUID(),
        email: link.email,
        role,
        orgId: null,
        name: null,
        emailVerifiedAt: now,
        createdAt: now,
      });
    } else if (!user.emailVerifiedAt) {
      await this.d.repo.markEmailVerified(user.id, now);
    }

    const sessionToken = generateSessionToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000);
    await this.d.sessions.create({
      tokenHash: hashSessionToken(sessionToken),
      userId: user.id,
      createdAt: now,
      expiresAt,
    });
    return { sessionToken, user, expiresAt };
  }
}
