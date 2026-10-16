/**
 * Real Postgres for DB tests.
 * - CI / your own DB: set TEST_DATABASE_URL (it will be migrated, then truncated per test).
 * - Otherwise an embedded Postgres 16 (npm `embedded-postgres`) is started on a free port.
 * `prisma migrate deploy` runs against it, so the committed migrations are what is tested.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const a = s.address();
      s.close(() => (typeof a === "object" && a ? resolve(a.port) : reject(new Error("no port"))));
    });
  });
}

export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let teardown = async () => {};
  if (!url) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const dir = mkdtempSync(join(tmpdir(), "lodeline-pg-"));
    const port = await freePort();
    const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false, onLog: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("lodeline_test");
    url = `postgresql://postgres:postgres@127.0.0.1:${port}/lodeline_test`;
    teardown = async () => {
      await pg.stop();
      rmSync(dir, { recursive: true, force: true });
    };
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  project.provide("databaseUrl", url);
  return teardown;
}
