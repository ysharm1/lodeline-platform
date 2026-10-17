import { describe, expect, it } from "vitest";
import { evaluate, QUESTIONS, validate } from "./readiness";

const base = { dod: "yes", material: "yes", asked: "no", maker: "all", upstream: "all", declaration: "all" } as const;

describe("readiness check (ported from lodeline.org readiness.js)", () => {
  it("has the six questions in order", () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(["dod", "material", "asked", "maker", "upstream", "declaration"]);
  });
  it("reports missing answers and never scores a partial form", () => {
    expect(validate({})).toHaveLength(6);
    expect(evaluate({ dod: "yes" })).toEqual({ complete: false, missing: ["material", "asked", "maker", "upstream", "declaration"] });
    expect(evaluate({ ...base, dod: "maybe" })).toMatchObject({ complete: false, missing: ["dod"] });
  });
  it("applicability branches", () => {
    const app = (a: object) => {
      const r = evaluate({ ...base, ...a });
      return r.complete ? r.applicability.key : null;
    };
    expect(app({})).toBe("strong");
    expect(app({ dod: "unsure", asked: "yes" })).toBe("strong");
    expect(app({ dod: "unsure" })).toBe("unclear");
    expect(app({ material: "no" })).toBe("few");
    expect(app({ material: "no", asked: "yes" })).toBe("unclear");
    expect(app({ dod: "no", asked: "unsure" })).toBe("few");
  });
  it("documentation branches", () => {
    const doc = (a: object) => {
      const r = evaluate({ ...base, ...a });
      return r.complete ? r.documentation.key : null;
    };
    expect(doc({})).toBe("developed");
    expect(doc({ declaration: "some" })).toBe("developed");
    expect(doc({ maker: "some", declaration: "some" })).toBe("partial");
    expect(doc({ upstream: "none" })).toBe("gaps");
    expect(doc({ maker: "some", upstream: "some", declaration: "none" })).toBe("gaps");
  });
  it("never claims compliance", () => {
    const r = evaluate(base);
    expect(JSON.stringify(r)).not.toMatch(/compliant|exempt|certified|%/i);
  });
});
