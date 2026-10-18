import { describe, expect, it, vi } from "vitest";
import { CachingGeocoder, MemoryGeocodeCache, NominatimGeocoder, Throttle, type Geocoder } from "./geocoder";

const fake = (): Geocoder & { calls: string[] } => {
  const calls: string[] = [];
  return { provider: "fake", calls, geocode: async (q) => (calls.push(q), q.includes("nowhere") ? null : { latitude: 1, longitude: 2, countryIso: "EE", displayName: q }) };
};

describe("geocoder caching", () => {
  it("hits the provider once per normalised address", async () => {
    const inner = fake();
    const g = new CachingGeocoder(inner, new MemoryGeocodeCache());
    await g.geocode("100 Industrial Rd, Tallinn");
    await g.geocode("  100 industrial rd,   TALLINN ");
    expect(inner.calls).toHaveLength(1);
  });
  it("caches misses too, but not errors", async () => {
    const inner = fake();
    const g = new CachingGeocoder(inner, new MemoryGeocodeCache());
    expect(await g.geocode("nowhere land")).toBeNull();
    expect(await g.geocode("nowhere land")).toBeNull();
    expect(inner.calls).toHaveLength(1);
    let n = 0;
    const flaky = new CachingGeocoder({ provider: "x", geocode: async () => { n++; throw new Error("503"); } }, new MemoryGeocodeCache());
    await expect(flaky.geocode("a")).rejects.toThrow();
    await expect(flaky.geocode("a")).rejects.toThrow();
    expect(n).toBe(2);
  });
  it("cache keys are per provider", () => {
    expect(CachingGeocoder.key("nominatim", "A")).not.toBe(CachingGeocoder.key("mapbox", "A"));
  });
});

describe("Nominatim adapter", () => {
  it("requires a contactable User-Agent and sends it", async () => {
    expect(() => new NominatimGeocoder("Lodeline")).toThrow(/User-Agent/);
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["User-Agent"]).toBe("Lodeline/0.2 (info@lodeline.org)");
      return new Response(JSON.stringify([{ lat: "59.43", lon: "24.75", display_name: "Tallinn", address: { country_code: "ee" } }]));
    });
    const g = new NominatimGeocoder("Lodeline/0.2 (info@lodeline.org)", fetchImpl as unknown as typeof fetch, new Throttle(0));
    expect(await g.geocode("Tallinn")).toEqual({ latitude: 59.43, longitude: 24.75, countryIso: "EE", displayName: "Tallinn" });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("format=jsonv2");
  });
  it("throttle spaces requests by the minimum interval", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const th = new Throttle(1100, () => t, async (ms) => { sleeps.push(ms); t += ms; });
    await Promise.all([th.run(async () => 1), th.run(async () => 2), th.run(async () => 3)]);
    expect(sleeps).toEqual([1100, 1100]);
  });
});

import { CountryCentroidGeocoder, listingPosition, NullGeocoder } from "./geocoder";
describe("offline country-centroid geocoder and listing positions", () => {
  it("resolves the country at the end of the query, approximately", async () => {
    const g = new CountryCentroidGeocoder();
    expect(await g.geocode("88 Example Road, Baotou, China")).toMatchObject({ countryIso: "CN" });
    expect(await g.geocode("100 Example Ave, Pittsburgh, PA, USA")).toMatchObject({ countryIso: "US" });
    expect(await g.geocode("Somewhere without a country")).toBeNull();
  });
  it("listing position falls back to the country centre when the geocoder finds nothing", async () => {
    expect(await listingPosition(new NullGeocoder(), "Nowhere", "JP")).toMatchObject({ geocodeProvider: "country-centroid", latitude: 36.2 });
    expect(await listingPosition(new NullGeocoder(), null, null)).toEqual({ latitude: null, longitude: null, geocodeProvider: null });
  });
});
