/**
 * The ONLY way Lodeline code talks to an LLM.
 *
 * Guarantees (enforced here, tested in llm.test.ts):
 *  1. Refuses to run unless LLM_ZDR_CONFIRMED === "true" (the vendor's
 *     zero-data-retention / no-training terms are confirmed in writing).
 *  2. Never logs prompt or completion content. The only telemetry is
 *     { provider, model, promptVersion, tokens, ms }.
 *  3. With no LLM_API_KEY it does not call out at all: it returns the
 *     deterministic keyword classifier's answer (mock mode), so tests and
 *     local dev work offline.
 *
 * Provider: any OpenAI-compatible chat-completions endpoint
 * (LLM_BASE_URL, default https://api.openai.com/v1). Output is validated with
 * zod; anything that does not validate is discarded in favour of the keyword
 * result.
 */
import { z } from "zod";
import { DomainError } from "@/domain/errors";
import { MATERIALS, type Material } from "@/domain/types";
import { keywordClassify } from "@/services/keyword-classifier";

export const PROMPT_VERSION = "classify-v1";

export class LlmGuardError extends DomainError {
  constructor() {
    super(
      "unavailable",
      "LLM_ZDR_NOT_CONFIRMED",
      "LLM use is disabled: set LLM_ZDR_CONFIRMED=true only after the vendor's zero-data-retention terms are confirmed."
    );
  }
}

export interface LlmConfig {
  zdrConfirmed: boolean;
  apiKey?: string;
  model: string;
  provider: string;
  baseUrl: string;
}

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  return {
    zdrConfirmed: env.LLM_ZDR_CONFIRMED === "true",
    apiKey: env.LLM_API_KEY?.trim() || undefined,
    model: env.LLM_MODEL?.trim() || "gpt-4o-mini",
    provider: env.LLM_PROVIDER?.trim() || "openai-compatible",
    baseUrl: (env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
  };
}

export interface ClassifyItem {
  id: string;
  description: string;
  partNumber?: string | null;
}
export interface ClassifyResult {
  id: string;
  materials: Material[];
  confidence: number;
  rationale: string;
}
export interface ClassifyResponse {
  results: ClassifyResult[];
  model: string;
  promptVersion: string;
  mode: "llm" | "mock";
}

export interface LlmTelemetry {
  provider: string;
  model: string;
  promptVersion: string;
  mode: "llm" | "mock";
  items: number;
  promptTokens?: number;
  completionTokens?: number;
  ms: number;
}

/** Metadata-only logger. Never receives content. */
export type LlmLogger = (t: LlmTelemetry) => void;
const defaultLogger: LlmLogger = (t) => console.info("[llm]", JSON.stringify(t));

const resultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      materials: z.array(z.enum(MATERIALS)),
      confidence: z.number().min(0).max(1),
      rationale: z.string().max(300),
    })
  ),
});

const SYSTEM_PROMPT = `You classify industrial/defense parts-list rows by likely critical-mineral content.
Materials: ndfeb (neodymium-iron-boron magnets: motors, actuators, speakers, servos, sensors, generators),
smco (samarium-cobalt magnets: high-temp motors, aerospace actuators, traveling-wave tubes),
tungsten (penetrators, ballast, counterweights, heavy alloy, electrodes, filaments),
tantalum (tantalum capacitors, superalloys), other (none of the above).
Return JSON {"results":[{"id","materials":[...],"confidence":0..1,"rationale":"<=25 words"}]}.
Answer "likely" only; do not invent facts about suppliers.`;

export class LlmClient {
  constructor(
    private readonly config: LlmConfig = llmConfigFromEnv(),
    private readonly log: LlmLogger = defaultLogger,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private guard(): void {
    if (!this.config.zdrConfirmed) throw new LlmGuardError();
  }

  get isLive(): boolean {
    return this.config.zdrConfirmed && !!this.config.apiKey;
  }

  async classifyParts(items: ClassifyItem[]): Promise<ClassifyResponse> {
    this.guard();
    const started = Date.now();
    const mock = (): ClassifyResponse => ({
      results: items.map((it) => ({ id: it.id, ...keywordClassify(`${it.partNumber ?? ""} ${it.description}`) })),
      model: "keyword-mock",
      promptVersion: PROMPT_VERSION,
      mode: "mock",
    });

    if (!this.config.apiKey) {
      const r = mock();
      this.log({ provider: "mock", model: r.model, promptVersion: PROMPT_VERSION, mode: "mock", items: items.length, ms: Date.now() - started });
      return r;
    }

    const res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        // OpenAI: do not store completions. Other vendors: ZDR is contractual.
        store: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(items.map((i) => ({ id: i.id, pn: i.partNumber ?? "", d: i.description }))) },
        ],
      }),
    });
    if (!res.ok) {
      // Status only. Response bodies can echo content, so they are not logged.
      this.log({ provider: this.config.provider, model: this.config.model, promptVersion: PROMPT_VERSION, mode: "llm", items: items.length, ms: Date.now() - started });
      throw new DomainError("unavailable", "LLM_REQUEST_FAILED", `LLM request failed with status ${res.status}.`);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    this.log({
      provider: this.config.provider,
      model: this.config.model,
      promptVersion: PROMPT_VERSION,
      mode: "llm",
      items: items.length,
      promptTokens: body.usage?.prompt_tokens,
      completionTokens: body.usage?.completion_tokens,
      ms: Date.now() - started,
    });
    let parsed: z.infer<typeof resultSchema> | null = null;
    try {
      parsed = resultSchema.parse(JSON.parse(body.choices?.[0]?.message?.content ?? ""));
    } catch {
      parsed = null;
    }
    const fallback = mock();
    const byId = new Map(parsed?.results.map((r) => [r.id, r]) ?? []);
    return {
      results: fallback.results.map((f) => byId.get(f.id) ?? f),
      model: this.config.model,
      promptVersion: PROMPT_VERSION,
      mode: "llm",
    };
  }
}
