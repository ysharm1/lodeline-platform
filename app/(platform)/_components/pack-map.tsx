"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  stage: string;
  covered: boolean;
}

/** Leaflet + OpenStreetMap tiles. Green = documented, red = covered country. */
export function PackMap({ points, emptyText = "No geocoded facilities from accepted evidence yet." }: { points: MapPoint[]; emptyText?: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || points.length === 0) return;
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      const layer = L.featureGroup();
      for (const p of points) {
        L.circleMarker([p.lat, p.lng], { radius: 8, color: p.covered ? "#e05252" : "#6fa37f", fillOpacity: 0.8, weight: 2 })
          .bindPopup(`<strong>${escapeHtml(p.label)}</strong><br/>${escapeHtml(p.stage)}${p.covered ? "<br/><b>Covered country</b>" : ""}`)
          .addTo(layer);
      }
      layer.addTo(map);
      map.fitBounds(layer.getBounds().pad(0.3), { maxZoom: 6 });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points]);
  if (points.length === 0) return <p className="text-sm text-muted">{emptyText}</p>;
  return <div ref={el} className="h-80 w-full rounded border border-line" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
