// Local Postgres without Docker: `npm run db:start` (data persists in .pgdata/).
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const port = Number(process.env.DEV_PG_PORT ?? 54329);
const dir = new URL("../.pgdata", import.meta.url).pathname;
const fresh = !existsSync(dir);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: true });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("lodeline");
console.log(`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${port}/lodeline`);
console.log("Ctrl-C to stop.");
const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
