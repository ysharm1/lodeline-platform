import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "../robots";
import sitemap from "../sitemap";
import { PUBLIC_PATHS } from "./seo";

const PAGES = join(__dirname, "pages");
const read = (n: string) => readFileSync(join(PAGES, `${n}.tsx`), "utf8");

describe("ported lodeline.org pages", () => {
  it("home keeps the live copy, sections, sources and contact details", () => {
    const home = read("home");
    for (const s of [
      "magnet-origin evidence",
      'id="rule"', 'id="method"', 'id="services"', 'id="industries"', 'id="check"', 'id="faq"', 'id="sources"', 'id="contact"', 'id="checklist"',
      "Agree the scope", "Hand over the pack",
      "Does recycled material count?",
      "acquisition.gov/dfars/252.225-7052",
      "mcs2026-rare-earths.pdf",
      "global-critical-minerals-outlook-2025",
      "mailto:info@lodeline.org", "tel:+16023159861", "(602) 315-9861",
      "not legal advice or government certification",
    ]) expect(home, s).toContain(s);
  });
  it("wires the platform CTAs", () => {
    const home = read("home");
    for (const href of ['href="/demo"', 'href="/suppliers"', 'href="/pack"', 'href="/login"', 'href="/for-suppliers"']) expect(home).toContain(href);
    expect(home).toContain("Try the free demo");
    expect(home).toContain("<ReadinessCheck />");
    expect(home).toContain("<LeadForm />");
    expect(home).toContain("<ChecklistForm />");
  });
  it("drops the third-party lead/visitor endpoints", () => {
    for (const f of readdirSync(PAGES)) {
      const src = readFileSync(join(PAGES, f), "utf8");
      expect(src).not.toMatch(/cornerstone|web3forms|HighLevel|ll_visit_day/i);
      expect(src).not.toContain("<script");
    }
  });
  it("every referenced /assets file exists in public/", () => {
    const refs = new Set<string>();
    for (const f of readdirSync(PAGES)) for (const m of readFileSync(join(PAGES, f), "utf8").matchAll(/\/assets\/[\w./-]+\.(?:jpg|svg|pdf)/g)) refs.add(m[0]);
    expect(refs.size).toBeGreaterThan(10);
    for (const r of refs) expect(existsSync(join(__dirname, "..", "..", "public", r)), r).toBe(true);
  });
});

describe("SEO", () => {
  it("sitemap lists public pages on APP_BASE_URL; robots blocks app routes", () => {
    const prev = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://lodeline.org/";
    try {
      const urls = sitemap().map((u) => u.url);
      expect(urls[0]).toBe("https://lodeline.org/");
      expect(urls).toContain("https://lodeline.org/industries/motors-actuators");
      expect(urls).toHaveLength(PUBLIC_PATHS.length);
      expect(urls.some((u) => /\/(admin|buyer|s|api)\//.test(u))).toBe(false);
      const r = robots();
      expect(r.sitemap).toBe("https://lodeline.org/sitemap.xml");
      expect(JSON.stringify(r.rules)).toContain("/admin/");
    } finally {
      process.env.APP_BASE_URL = prev;
    }
  });
});
