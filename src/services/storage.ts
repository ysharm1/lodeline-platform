/** Document storage port. S3 adapter in src/infra/s3-document-storage.ts. */
export interface StoredObject {
  key: string;
  body: Uint8Array;
  contentType: string;
}
export interface DocumentStorage {
  readonly name: string;
  put(obj: StoredObject): Promise<string>;
}

/** Dev/test only: keeps bytes in process memory. */
export class MemoryDocumentStorage implements DocumentStorage {
  readonly name = "memory";
  readonly objects = new Map<string, StoredObject>();
  async put(obj: StoredObject): Promise<string> {
    this.objects.set(obj.key, obj);
    return obj.key;
  }
}
