import { describe, expect, it, vi } from "vitest";
import { LlmClient, LlmGuardError, llmConfigFromEnv, type LlmTelemetry } from "./llm";

const items = [
  { id: "0", description: "SECRET-PROJECT BLDC motor", partNumber: "PN-SECRET-1" },
  { id: "1", description: "hex bolt" },
];
const base = { model: "test-model", provider: "test", baseUrl: "https://llm.invalid/v1" };

describe("LLM wrapper guard", () => {
  it("refuses unless LLM_ZDR_CONFIRMED is exactly 'true'", async () => {
    for (const v of [undefined, "", "false", "TRUE", "yes", "1"]) {
      const cfg = llmConfigFromEnv({ LLM_ZDR_CONFIRMED: v, LLM_API_KEY: "k" } as unknown as NodeJS.ProcessEnv);
      const fetchImpl = vi.fn();
      await expect(new LlmClient(cfg, () => {}, fetchImpl as unknown as typeof fetch).classifyParts(items)).rejects.toBeInstanceOf(LlmGuardError);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("uses deterministic mock with no API key and never calls the network", async () => {
    const fetchImpl = vi.fn();
    const r = await new LlmClient({ ...base, zdrConfirmed: true }, () => {}, fetchImpl as unknown as typeof fetch).classifyParts(items);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.mode).toBe("mock");
    expect(r.results[0].materials).toEqual(["ndfeb"]);
    expect(r.results[1].materials).toEqual(["other"]);
  });

  it("never logs content (telemetry and console)", async () => {
    const logs: LlmTelemetry[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results: [{ id: "0", materials: ["ndfeb"], confidence: 0.9, rationale: "motor" }] }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 })
    );
    const client = new LlmClient({ ...base, zdrConfirmed: true, apiKey: "sk-test" }, (t) => logs.push(t), fetchImpl as unknown as typeof fetch);
    await client.classifyParts(items);
    const logged = JSON.stringify(logs) + JSON.stringify(spies.map((s) => s.mock.calls));
    expect(logged).not.toMatch(/SECRET|bolt|PN-/);
    expect(logs[0]).toMatchObject({ model: "test-model", promptVersion: "classify-v1", promptTokens: 10, completionTokens: 5 });
    spies.forEach((s) => s.mockRestore());
  });

  it("validates LLM output and falls back to keywords on garbage", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }));
    const r = await new LlmClient({ ...base, zdrConfirmed: true, apiKey: "k" }, () => {}, fetchImpl as unknown as typeof fetch).classifyParts(items);
    expect(r.results.map((x) => x.materials)).toEqual([["ndfeb"], ["other"]]);
  });

  it("sends store:false and surfaces HTTP failures without body", async () => {
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).store).toBe(false);
      return new Response("upstream echoed SECRET", { status: 500 });
    });
    await expect(
      new LlmClient({ ...base, zdrConfirmed: true, apiKey: "k" }, () => {}, fetchImpl as unknown as typeof fetch).classifyParts(items)
    ).rejects.toThrow(/status 500\.$/);
  });
});
