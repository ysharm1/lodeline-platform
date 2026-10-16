import { PrismaClient } from "@prisma/client";
import { inject } from "vitest";

let client: PrismaClient | undefined;
export function testPrisma(): PrismaClient {
  return (client ??= new PrismaClient({ datasourceUrl: inject("databaseUrl") }));
}

export async function resetDb(): Promise<void> {
  const db = testPrisma();
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`);
}
