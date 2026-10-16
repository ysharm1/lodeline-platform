/**
 * Pluggable geocoding with a DB cache.
 *  GEOCODER=nominatim (default): OpenStreetMap Nominatim. Usage policy: a real
 *    User-Agent with contact (GEOCODER_USER_AGENT), max 1 request/second,
 *    results cached (we never re-ask for the same address).
 *  GEOCODER=mapbox: MAPBOX_TOKEN required.
 *  GEOCODER=none: offline (tests/dev).
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  countryIso: string | null;
  displayName: string | null;
}
export interface Geocoder {
  readonly provider: string;
  geocode(query: string): Promise<GeocodeResult | null>;
}

export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

export class NullGeocoder implements Geocoder {
  readonly provider = "none";
  async geocode(): Promise<GeocodeResult | null> {
    return null;
  }
}

/** Serialises calls so at most one request starts per `minIntervalMs`. */
export class Throttle {
  private last = Number.NEGATIVE_INFINITY;
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly minIntervalMs: number, private readonly clock = () => Date.now(), private readonly sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {}
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.last + this.minIntervalMs - this.clock();
      if (wait > 0) await this.sleep(wait);
      this.last = this.clock();
    });
    this.chain = next.catch(() => {});
    return next.then(fn);
  }
}

export class NominatimGeocoder implements Geocoder {
  readonly provider = "nominatim";
  constructor(
    private readonly userAgent: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly throttle = new Throttle(1100),
    private readonly baseUrl = "https://nominatim.openstreetmap.org"
  ) {
    if (!/\S+@\S+|https?:\/\//.test(userAgent)) throw new Error("Nominatim requires a User-Agent with contact info (GEOCODER_USER_AGENT)");
  }
  async geocode(query: string): Promise<GeocodeResult | null> {
    return this.throttle.run(async () => {
      const url = `${this.baseUrl}/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`;
      const res = await this.fetchImpl(url, { headers: { "User-Agent": this.userAgent, "Accept-Language": "en" } });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      const rows = (await res.json()) as { lat: string; lon: string; display_name?: string; address?: { country_code?: string } }[];
      const r = rows[0];
      if (!r) return null;
      return { latitude: Number(r.lat), longitude: Number(r.lon), countryIso: r.address?.country_code?.toUpperCase() ?? null, displayName: r.display_name ?? null };
    });
  }
}

export class MapboxGeocoder implements Geocoder {
  readonly provider = "mapbox";
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async geocode(query: string): Promise<GeocodeResult | null> {
    const url = `https://api.mapbox.com/search/geocode/v6/forward?limit=1&q=${encodeURIComponent(query)}&access_token=${encodeURIComponent(this.token)}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`Mapbox ${res.status}`);
    const body = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties?: { full_address?: string; context?: { country?: { country_code?: string } } } }[] };
    const f = body.features?.[0];
    if (!f) return null;
    return {
      longitude: f.geometry.coordinates[0],
      latitude: f.geometry.coordinates[1],
      countryIso: f.properties?.context?.country?.country_code?.toUpperCase() ?? null,
      displayName: f.properties?.full_address ?? null,
    };
  }
}

export interface CachedGeocode {
  found: boolean;
  result: GeocodeResult | null;
}
export interface GeocodeCacheStore {
  get(hash: string): Promise<CachedGeocode | null>;
  put(hash: string, query: string, provider: string, result: GeocodeResult | null): Promise<void>;
}

export class MemoryGeocodeCache implements GeocodeCacheStore {
  readonly rows = new Map<string, CachedGeocode>();
  async get(h: string) {
    return this.rows.get(h) ?? null;
  }
  async put(h: string, _q: string, _p: string, r: GeocodeResult | null) {
    this.rows.set(h, { found: !!r, result: r });
  }
}

export class PrismaGeocodeCache implements GeocodeCacheStore {
  constructor(private readonly db: PrismaClient) {}
  async get(queryHash: string): Promise<CachedGeocode | null> {
    const row = await this.db.geocodeCache.findUnique({ where: { queryHash } });
    if (!row) return null;
    return {
      found: row.found,
      result: row.found ? { latitude: row.latitude!, longitude: row.longitude!, countryIso: row.countryIso, displayName: row.displayName } : null,
    };
  }
  async put(queryHash: string, query: string, provider: string, r: GeocodeResult | null) {
    await this.db.geocodeCache.upsert({
      where: { queryHash },
      create: { queryHash, query, provider, found: !!r, latitude: r?.latitude, longitude: r?.longitude, countryIso: r?.countryIso, displayName: r?.displayName },
      update: {},
    });
  }
}

/** Cache-first wrapper. Misses ("not found") are cached too; errors are not. */
export class CachingGeocoder implements Geocoder {
  constructor(private readonly inner: Geocoder, private readonly cache: GeocodeCacheStore) {}
  get provider() {
    return this.inner.provider;
  }
  static key(provider: string, query: string) {
    return createHash("sha256").update(`${provider}|${normalizeQuery(query)}`).digest("hex");
  }
  async geocode(query: string): Promise<GeocodeResult | null> {
    const q = normalizeQuery(query);
    if (!q) return null;
    const h = CachingGeocoder.key(this.inner.provider, q);
    const hit = await this.cache.get(h);
    if (hit) return hit.result;
    const r = await this.inner.geocode(query.trim());
    await this.cache.put(h, q, this.inner.provider, r);
    return r;
  }
}

let sharedThrottle: Throttle | undefined;
export function geocoderFromEnv(db: PrismaClient | null, env: NodeJS.ProcessEnv = process.env): Geocoder {
  const kind = (env.GEOCODER ?? (env.NODE_ENV === "test" ? "none" : "nominatim")).toLowerCase();
  let inner: Geocoder;
  if (kind === "mapbox") {
    if (!env.MAPBOX_TOKEN) throw new Error("GEOCODER=mapbox requires MAPBOX_TOKEN");
    inner = new MapboxGeocoder(env.MAPBOX_TOKEN);
  } else if (kind === "nominatim") {
    inner = new NominatimGeocoder(env.GEOCODER_USER_AGENT ?? "Lodeline/0.2 (info@lodeline.org)", fetch, (sharedThrottle ??= new Throttle(1100)), env.NOMINATIM_BASE_URL);
  } else {
    inner = new NullGeocoder();
  }
  return new CachingGeocoder(inner, db ? new PrismaGeocodeCache(db) : new MemoryGeocodeCache());
}
