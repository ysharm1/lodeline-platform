import type { PrismaClient } from "@prisma/client";
import { ConsoleEmailSender } from "@/infra/email";
import { DevBilling, type Billing } from "@/infra/billing";
import { LlmClient } from "@/infra/llm";
import { PrismaRepository } from "@/repository/prisma";
import { AuditService } from "@/services/audit";
import { CachingGeocoder, PrismaGeocodeCache, type Geocoder } from "@/services/geocoder";
import type { PlatformDeps } from "@/services/deps";
import { MemoryDocumentStorage } from "@/services/storage";

export const fakeGeocoder = (): Geocoder & { calls: string[] } => {
  const calls: string[] = [];
  const table: [RegExp, { latitude: number; longitude: number; countryIso: string }][] = [
    [/tallinn|estonia/i, { latitude: 59.437, longitude: 24.7536, countryIso: "EE" }],
    [/baotou|china/i, { latitude: 40.6574, longitude: 109.8403, countryIso: "CN" }],
    [/osaka|japan/i, { latitude: 34.6937, longitude: 135.5023, countryIso: "JP" }],
  ];
  return {
    provider: "fake",
    calls,
    async geocode(q) {
      calls.push(q);
      const hit = table.find(([re]) => re.test(q));
      return hit ? { ...hit[1], displayName: q } : null;
    },
  };
};

export function makeDeps(db: PrismaClient, opts: { now?: () => Date; billing?: Billing } = {}) {
  const email = new ConsoleEmailSender(true);
  const storage = new MemoryDocumentStorage();
  const repo = new PrismaRepository(db);
  const audit = new AuditService(repo, opts.now);
  const rawGeo = fakeGeocoder();
  const deps: PlatformDeps = {
    db,
    audit,
    email,
    storage,
    billing: opts.billing ?? new DevBilling(),
    llm: new LlmClient({ zdrConfirmed: true, model: "m", provider: "p", baseUrl: "x" }, () => {}),
    geocoder: new CachingGeocoder(rawGeo, new PrismaGeocodeCache(db)),
    baseUrl: "https://app.test",
    now: opts.now,
  };
  return { deps, email, storage, repo, rawGeo };
}
