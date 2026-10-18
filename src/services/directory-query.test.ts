import { describe, expect, it, vi } from "vitest";
import { keywordParseDirectoryQuery, templateAnswer } from "./directory-query";
import { LlmClient } from "@/infra/llm";

const rows = [
  { id: "L1", name: "Example Magnet Works (sample)", countryIso: "US", city: "Example City", stages: ["magnet"], materials: ["ndfeb"], verified: false, isExample: true, summary: "" },
  { id: "L2", name: "Example Separation Co (sample)", countryIso: "EE", city: null, stages: ["separation"], materials: ["ndfeb"], verified: true, isExample: true, summary: "" },
];

describe("directory query parsing (no LLM)", () => {
  it("extracts materials, stages, countries, exclusions, verified", () => {
    expect(keywordParseDirectoryQuery("verified NdFeB separation suppliers outside China in Estonia or Japan")).toEqual({
      q: "", materials: ["ndfeb"], stages: ["separation"], countries: ["EE", "JP"], excludeCountries: ["CN"], verifiedOnly: true,
    });
    expect(keywordParseDirectoryQuery("who makes magnets in the US?")).toMatchObject({ materials: ["ndfeb", "smco"], stages: ["magnet"], countries: ["US"] });
    expect(keywordParseDirectoryQuery("china-free tungsten refiners")).toMatchObject({ materials: ["tungsten"], stages: ["separation"], excludeCountries: ["CN"] });
  });
  it("template answer cites only given rows and marks examples", () => {
    const a = templateAnswer(rows);
    expect(a.citedIds).toEqual(["L1", "L2"]);
    expect(a.answer).toContain("(example listing)");
  });
});

describe("LLM answer grounding", () => {
  const llm = (content: unknown) =>
    new LlmClient({ zdrConfirmed: true, apiKey: "k", model: "m", provider: "p", baseUrl: "https://x.invalid" }, () => {}, (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))) as unknown as typeof fetch);

  it("keeps a grounded answer and maps refs to listing ids", async () => {
    const r = await llm({ answer: "Try [2].", citedRefs: [2] }).answerFromListings("q", rows);
    expect(r).toEqual({ answer: "Try [2].", citedIds: ["L2"], mode: "llm" });
  });
  it("replaces answers citing refs outside the rows (invented suppliers)", async () => {
    const r = await llm({ answer: "Use Real Corp [7] or [1].", citedRefs: [7] }).answerFromListings("q", rows);
    expect(r.mode).toBe("mock");
    expect(r.citedIds).toEqual(["L1", "L2"]);
  });
  it("never calls the LLM with zero rows", async () => {
    const f = vi.fn();
    const c = new LlmClient({ zdrConfirmed: true, apiKey: "k", model: "m", provider: "p", baseUrl: "x" }, () => {}, f as unknown as typeof fetch);
    expect((await c.answerFromListings("q", [])).citedIds).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
  it("keyword fallback without an API key", async () => {
    const c = new LlmClient({ zdrConfirmed: true, model: "m", provider: "p", baseUrl: "x" }, () => {});
    expect((await c.parseDirectoryQuery("tantalum in Japan")).countries).toEqual(["JP"]);
    expect((await c.answerFromListings("q", rows)).mode).toBe("mock");
  });
});

import { parseFilterParams } from "./directory";
describe("China-free directory filter", () => {
  it("excludeCovered=1 excludes every DFARS covered country, merged with explicit exclusions", () => {
    expect(parseFilterParams({ excludeCovered: "1", excludeCountry: "JP" }).excludeCountries.sort()).toEqual(["CN", "IR", "JP", "KP", "RU"]);
    expect(parseFilterParams({}).excludeCountries).toEqual([]);
  });
});
