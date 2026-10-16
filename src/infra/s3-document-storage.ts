/**
 * S3 document storage (generalized from LoadEnergy
 * src/infra/s3-ticket-photo-storage.ts). US region by default (us-west-2),
 * SSE on every object, presigned PUT (Content-Length signed so the size is
 * enforced by S3) and short-TTL presigned GET.
 * The bucket needs CORS allowing PUT from APP_BASE_URL (see README).
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DocumentStorage, PresignedPut, StoredObject } from "@/services/storage";

export const DEFAULT_S3_REGION = "us-west-2";

function optionalEnv(key: string): string | undefined {
  const v = process.env[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

export function isS3Configured(): boolean {
  return optionalEnv("S3_DOCS_BUCKET") !== undefined;
}

export class S3DocumentStorage implements DocumentStorage {
  readonly name = "s3";
  private readonly client: S3Client;
  constructor(private readonly bucket: string, region: string, endpoint?: string, client?: S3Client) {
    this.client = client ?? new S3Client({ region, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
  }

  static fromEnv(): S3DocumentStorage {
    const bucket = optionalEnv("S3_DOCS_BUCKET");
    if (!bucket) throw new Error("Missing required environment variable S3_DOCS_BUCKET");
    return new S3DocumentStorage(bucket, optionalEnv("AWS_REGION") ?? DEFAULT_S3_REGION, optionalEnv("S3_ENDPOINT"));
  }

  async put(obj: StoredObject): Promise<string> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: obj.key, Body: obj.body, ContentType: obj.contentType, ServerSideEncryption: "AES256" }));
    return obj.key;
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.Body ? await r.Body.transformToByteArray() : null;
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async presignPut(key: string, contentType: string, sizeBytes: number, ttlSec = 600): Promise<PresignedPut> {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes, ServerSideEncryption: "AES256" });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: ttlSec, signableHeaders: new Set(["content-type", "content-length", "x-amz-server-side-encryption"]) });
    return { url, method: "PUT", headers: { "content-type": contentType, "x-amz-server-side-encryption": "AES256" }, expiresAt: new Date(Date.now() + ttlSec * 1000) };
  }

  async presignGet(key: string, ttlSec = 300, fileName?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(fileName ? { ResponseContentDisposition: `inline; filename="${fileName.replace(/"/g, "")}"` } : {}) }),
      { expiresIn: ttlSec }
    );
  }
}
