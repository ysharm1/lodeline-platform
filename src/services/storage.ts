/**
 * Document storage port. Browser uploads go DIRECT to storage via a presigned
 * PUT (keeps bodies off the app server: Vercel's 4.5 MB request cap, Render memory).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface StoredObject {
  key: string;
  body: Uint8Array;
  contentType: string;
}
export interface PresignedPut {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: Date;
}
export interface DocumentStorage {
  readonly name: string;
  put(obj: StoredObject): Promise<string>;
  get(key: string): Promise<Uint8Array | null>;
  presignPut(key: string, contentType: string, sizeBytes: number, ttlSec?: number): Promise<PresignedPut>;
  presignGet(key: string, ttlSec?: number, fileName?: string): Promise<string>;
}

/** Tests only. */
export class MemoryDocumentStorage implements DocumentStorage {
  readonly name = "memory";
  readonly objects = new Map<string, StoredObject>();
  async put(obj: StoredObject) {
    this.objects.set(obj.key, obj);
    return obj.key;
  }
  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }
  async presignPut(key: string, contentType: string, sizeBytes: number, ttlSec = 600): Promise<PresignedPut> {
    return { url: `memory://${key}`, method: "PUT", headers: { "content-type": contentType, "content-length": String(sizeBytes) }, expiresAt: new Date(Date.now() + ttlSec * 1000) };
  }
  async presignGet(key: string) {
    return `memory://${key}`;
  }
}

/**
 * Dev storage on local disk (.uploads/). Presigned URLs point at
 * /api/uploads/local and carry an HMAC so the route only accepts the exact
 * key/size/expiry it issued. Not for production.
 */
export class LocalDiskStorage implements DocumentStorage {
  readonly name = "local";
  constructor(private readonly root: string, private readonly baseUrl: string, private readonly secret: string) {}
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(resolve(this.root))) throw new Error("bad key");
    return p;
  }
  sign(parts: string[]): string {
    return createHmac("sha256", this.secret).update(parts.join("|")).digest("base64url");
  }
  verify(parts: string[], sig: string): boolean {
    const a = Buffer.from(this.sign(parts));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  async put(obj: StoredObject) {
    const p = this.path(obj.key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, obj.body);
    return obj.key;
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }
  async presignPut(key: string, contentType: string, sizeBytes: number, ttlSec = 600): Promise<PresignedPut> {
    const exp = String(Math.floor(Date.now() / 1000) + ttlSec);
    const sig = this.sign(["put", key, String(sizeBytes), exp]);
    const q = new URLSearchParams({ key, size: String(sizeBytes), exp, sig });
    return { url: `${this.baseUrl}/api/uploads/local?${q}`, method: "PUT", headers: { "content-type": contentType }, expiresAt: new Date(Number(exp) * 1000) };
  }
  async presignGet(key: string, ttlSec = 300) {
    const exp = String(Math.floor(Date.now() / 1000) + ttlSec);
    const q = new URLSearchParams({ key, exp, sig: this.sign(["get", key, exp]) });
    return `${this.baseUrl}/api/uploads/local?${q}`;
  }
}
