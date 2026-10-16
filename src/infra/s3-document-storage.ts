/**
 * S3 document storage (generalized from LoadEnergy
 * src/infra/s3-ticket-photo-storage.ts). US region by default (us-west-2),
 * server-side encryption on every object, lazy env, optional S3_ENDPOINT.
 * TODO(week 2): presigned GET with short TTL for pack PDFs / reviewer view.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { DocumentStorage, StoredObject } from "@/services/storage";

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
    this.client =
      client ?? new S3Client({ region, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
  }

  static fromEnv(): S3DocumentStorage {
    const bucket = optionalEnv("S3_DOCS_BUCKET");
    if (!bucket) throw new Error("Missing required environment variable S3_DOCS_BUCKET");
    return new S3DocumentStorage(bucket, optionalEnv("AWS_REGION") ?? DEFAULT_S3_REGION, optionalEnv("S3_ENDPOINT"));
  }

  async put(obj: StoredObject): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: obj.key,
        Body: obj.body,
        ContentType: obj.contentType,
        ServerSideEncryption: "AES256",
      })
    );
    return obj.key;
  }
}
