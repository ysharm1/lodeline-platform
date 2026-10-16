/**
 * Seed: optional admin user + a few CLEARLY MARKED example directory rows.
 * No real companies and no claims about real companies.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const EXAMPLES = [
  { name: "Example Magnet Works (sample listing)", summary: "Fictional sintered NdFeB magnet maker used to demonstrate the directory. Not a real company.", city: "Example City", countryIso: "US", stages: ["magnet"], materials: ["ndfeb"] },
  { name: "Example Separation Co. (sample listing)", summary: "Fictional rare earth oxide separation and refining operation. Not a real company.", city: "Sampleton", countryIso: "CA", stages: ["separation"], materials: ["ndfeb", "smco"] },
  { name: "Example Alloy Smelter (sample listing)", summary: "Fictional NdPr metal and alloy producer. Not a real company.", city: "Demo Town", countryIso: "JP", stages: ["metal_alloy"], materials: ["ndfeb"] },
  { name: "Example Tungsten Refinery (sample listing)", summary: "Fictional APT and tungsten powder refiner. Not a real company.", city: "Placeholder", countryIso: "AT", stages: ["separation", "metal_alloy"], materials: ["tungsten"] },
] as const;

async function main() {
  const admin = process.env.SEED_ADMIN_EMAIL?.split(",")[0]?.trim().toLowerCase();
  if (admin) await db.user.upsert({ where: { email: admin }, create: { email: admin, role: "admin" }, update: { role: "admin" } });
  for (const e of EXAMPLES) {
    const exists = await db.supplierListing.findFirst({ where: { name: e.name } });
    if (!exists) await db.supplierListing.create({ data: { ...e, stages: [...e.stages], materials: [...e.materials], countries: [e.countryIso], published: true, isExample: true } });
  }
  console.log(`Seeded ${EXAMPLES.length} example listings${admin ? ` and admin ${admin}` : ""}.`);
}

main().finally(() => db.$disconnect());
