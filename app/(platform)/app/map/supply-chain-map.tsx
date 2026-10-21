"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export interface ChainPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  countryIso: string | null;
  stages: string[];
  covered: boolean;
  approximate: boolean;
}
export interface ChainStage { key: string; label: string; color: string }

/** Small deterministic offset so country-level pins do not sit exactly on top of each other. */
function jitter(id: string): [number, number] {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return [((h & 0xff) / 255 - 0.5) * 1.6, (((h >> 8) & 0xff) / 255 - 0.5) * 1.6];
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Leaflet map: suppliers by stage (mine -> refine -> alloy -> magnet), with stage filters. */
export function SupplyChainMap({ points, stages, initial }: { points: ChainPoint[]; stages: ChainStage[]; initial: string[] }) {
  const [on, setOn] = useState<string[]>(initial.length ? initial : stages.map((s) => s.key));
  const el = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => points.filter((p) => p.stages.some((s) => on.includes(s))), [points, on]);
  useEffect(() => {
    if (!el.current || visible.length === 0) return;
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      const layer = L.featureGroup();
      for (const p of visible) {
        const first = stages.find((s) => on.includes(s.key) && p.stages.includes(s.key))!;
        const [dy, dx] = p.approximate ? jitter(p.id) : [0, 0];
        const labels = stages.filter((s) => p.stages.includes(s.key)).map((s) => s.label).join(" → ");
        L.circleMarker([p.lat + dy, p.lng + dx], { radius: 7, color: p.covered ? "#e05252" : first.color, fillColor: first.color, fillOpacity: 0.85, weight: p.covered ? 3 : 1 })
          .bindPopup(`<strong>${esc(p.name)}</strong><br/>${esc(p.countryIso ?? "")}<br/>${esc(labels)}${p.covered ? "<br/><b>Covered country</b>" : ""}<br/><a href="/app/marketplace/${p.id}">Open listing</a>`)
          .addTo(layer);
      }
      layer.addTo(map);
      map.fitBounds(layer.getBounds().pad(0.2), { maxZoom: 5 });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [visible, on, stages]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="stage-filters">
        {stages.map((s, i) => (
          <label key={s.key} className="flex items-center gap-1.5">
            <input type="checkbox" checked={on.includes(s.key)} onChange={(e) => setOn((cur) => (e.target.checked ? [...cur, s.key] : cur.filter((x) => x !== s.key)))} />
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: s.color }} />
            {s.label}
            {i < stages.length - 1 ? <span className="text-muted pl-1">→</span> : null}
          </label>
        ))}
      </div>
      {visible.length === 0 ? <p className="text-sm text-muted">No suppliers for the selected stages.</p> : <div ref={el} className="h-[28rem] w-full rounded border border-line" />}
      <p className="text-xs text-muted">{visible.length} supplier(s) shown. Most positions are country-level and approximate. A red ring marks a covered country.</p>
    </div>
  );
}
