import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "../robots";
import sitemap from "../sitemap";
import { PUBLIC_PATHS } from "./seo";

const PAGES = join(__dirname, "pages");
const read = (n: string) => readFileSync(join(PAGES, `${n}.tsx`), "utf8");
/** Owner-approved additions (scripts/port-site.py ADDITIONS) carry data-ll-added; everything else must match lodeline.org. */
const ADDED_RE = /<(\w+)\b[^>]*\bdata-ll-added="[^"]*"[^>]*>[\s\S]*?<\/\1>(\{" "\})?/g;
const withoutAdditions = (tsx: string) => tsx.replace(ADDED_RE, "");

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
  it("is a 1:1 copy: same visible text, links and classes as the live page", () => {
    const VENDOR = join(__dirname, "..", "..", "vendor", "lodeline-site");
    const files: Record<string, string> = {
      home: "index.html", "sample-evidence-pack": "sample-evidence-pack.html", privacy: "privacy.html", "readiness-checklist": "readiness-checklist.html",
      "industry-aerospace-assemblies": "industries_aerospace-assemblies.html", "industry-motors-actuators": "industries_motors-actuators.html",
      "industry-power-generation": "industries_power-generation.html", "industry-uas-components": "industries_uas-components.html",
    };
    const ent: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " };
    const words = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => e.startsWith("#x") || e.startsWith("#X") ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith("#") ? String.fromCodePoint(+e.slice(1)) : ent[e] ?? m).match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const [page, file] of Object.entries(files)) {
      let html = readFileSync(join(VENDOR, file), "utf8");
      html = html.slice(html.indexOf("<body"));
      html = html.replace(/<(script|noscript)[\s\S]*?<\/\1>/g, "");
      html = html.replace(/<form[^>]*id="(quiz|lead|magnet)"[\s\S]*?<\/form>/g, "").replace(/<!--[\s\S]*?-->/g, "");
      let tsx = withoutAdditions(read(page));
      tsx = tsx.slice(tsx.indexOf("return (") + "return (".length);
      const vHref = new Set([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/^assets\//, "/assets/").replace(/&amp;/g, "&")));
      const gHref = new Set([...tsx.matchAll(/href=(?:"([^"]*)"|\{"((?:[^"\\]|\\.)*)"\})/g)].map((m) => m[1] ?? JSON.parse(`"${m[2]}"`)));
      expect([...gHref].sort(), page).toEqual([...vHref].sort());
      const vCls = new Set([...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]));
      const gCls = new Set([...tsx.matchAll(/className="([^"]*)"/g)].map((m) => m[1]).filter((c) => !c.startsWith("ll-site")));
      for (const c of gCls) expect(vCls.has(c), `${page}: class ${c}`).toBe(true);
      const gText = tsx.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\{("(?:[^"\\]|\\.)*")\}/g, (_, j) => JSON.parse(j)).replace(/<[^>]+>/g, " ");
      const vText = html.replace(/<[^>]+>/g, " ");
      expect(words(gText).join(" "), page).toBe(words(vText).join(" "));
    }
  });
  it("has only the approved, marked additions, each linking into the platform", () => {
    const home = read("home");
    const added = [...home.matchAll(ADDED_RE)].map((m) => m[0]);
    expect(added).toHaveLength(1);
    expect(added[0]).toContain('href="/audit"');
    expect(added[0]).toContain('data-ll-added="free-audit"');
    expect(added[0]).toContain("Run a free parts audit");
    for (const f of readdirSync(PAGES)) {
      if (f === "home.tsx") continue;
      expect(readFileSync(join(PAGES, f), "utf8"), f).not.toContain("data-ll-added");
    }
  });
  it("keeps the interactive islands", () => {
    const home = read("home");
    expect(home).toContain("<ReadinessCheck />");
    expect(home).toContain("<LeadForm />");
    expect(home).toContain("<ChecklistForm />");
  });
  it("drops the third-party lead/visitor endpoints", () => {
    for (const f of readdirSync(PAGES)) {
      const src = readFileSync(join(PAGES, f), "utf8");
      // The copy (incl. the privacy notice) is verbatim; only the third-party endpoints are gone.
      expect(src).not.toMatch(/cornerstone-gr0wth|api\.web3forms\.com|sendBeacon/i);
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
      // No disallow rule may prefix-match a public page such as /suppliers or /for-suppliers.
      const dis = ([] as string[]).concat(...[r.rules].flat().map((x) => [x.disallow ?? []].flat()));
      for (const u of urls) expect(dis.some((d) => new URL(u).pathname.startsWith(d)), u).toBe(false);
    } finally {
      process.env.APP_BASE_URL = prev;
    }
  });
});
