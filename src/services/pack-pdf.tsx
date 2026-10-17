/**
 * Evidence pack PDF. Built ONLY from the database: accepted claims, the
 * document register (with SHA-256), the part x stage matrix, open questions,
 * a facility coordinate table (no external map tiles in the PDF), stated
 * limits and the disclaimer.
 */
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { CellStatus, MatrixRow } from "./pack-matrix";
import { openQuestions } from "./pack-matrix";
import { STAGE_LABELS } from "./stage-rules";

export const PDF_DISCLAIMER =
  "Lodeline provides supply-chain documentation and analysis, not legal advice or government certification. This pack is an evidence compilation, not a compliance determination. Applicability, exceptions, and acceptance depend on the contract and the responsible reviewer.";

export const STATED_LIMITS = [
  "Only documents supplied by the listed suppliers were reviewed; Lodeline did not audit facilities.",
  "A stage is shown as documented only where a reviewer accepted a claim whose quote appears verbatim on the cited page.",
  "Covered-country flags (CN, RU, IR, KP) are applied deterministically from the stated country and the geocoded address.",
  "Parts were selected from the buyer's parts list as likely covered or possible (confirm with supplier). These are classifications from part data, not supplier statements; parts marked possible stay listed until the supplier confirms the material.",
  "Geocoded coordinates are approximate (OpenStreetMap/Mapbox) and identify a location, not a verified facility.",
  "Documents can be outdated, incomplete or inaccurate; dates and issuers are reported as stated.",
];

export interface PackPdfData {
  packId: string;
  orgName: string;
  generatedAt: Date;
  sourceFileName: string;
  matrix: MatrixRow[];
  claims: {
    id: string;
    stage: string | null;
    facilityName: string | null;
    address: string | null;
    country: string | null;
    countryIso: string | null;
    latitude: number | null;
    longitude: number | null;
    coveredCountry: boolean;
    issuer: string | null;
    issueDate: Date | null;
    documentId: string;
    supplierName: string;
    citations: { field: string; page: number; quote: string }[];
  }[];
  documents: { id: string; fileName: string; sha256: string; supplierName: string; uploadedAt: Date; pageCount: number | null }[];
  supplierForPart: Record<string, string>;
}

const STATUS_LABEL: Record<CellStatus, string> = {
  documented: "Documented",
  covered_country: "Covered country",
  in_review: "Pending review",
  requested: "Requested",
  no_document: "No document",
};

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  h1: { fontSize: 18, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 12, marginTop: 14, marginBottom: 6, fontFamily: "Helvetica-Bold" },
  muted: { color: "#555" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ccc", paddingVertical: 3 },
  th: { fontFamily: "Helvetica-Bold" },
  disclaimer: { marginTop: 10, padding: 6, borderWidth: 0.5, borderColor: "#999", fontSize: 8 },
  footer: { position: "absolute", bottom: 18, left: 36, right: 36, fontSize: 7, color: "#777" },
});

function Cell({ w, children, bold }: { w: string; children: React.ReactNode; bold?: boolean }) {
  return <Text style={[{ width: w, paddingRight: 4 }, bold ? s.th : {}]}>{children}</Text>;
}

export function PackPdf({ data }: { data: PackPdfData }) {
  const questions = openQuestions(data.matrix, (pid) => data.supplierForPart[pid] ?? null);
  return (
    <Document title={`Lodeline evidence pack ${data.packId.slice(0, 8)}`} author="Lodeline">
      <Page size="LETTER" style={s.page}>
        <Text style={s.h1}>Evidence pack</Text>
        <Text style={s.muted}>
          {data.orgName} · Pack {data.packId.slice(0, 8)} · Source list {data.sourceFileName} · Generated {data.generatedAt.toISOString().slice(0, 10)} (UTC)
        </Text>
        <Text style={s.disclaimer}>{PDF_DISCLAIMER}</Text>

        <Text style={s.h2}>1. Stage status per part</Text>
        <View style={[s.row]}>
          <Cell w="22%" bold>Part</Cell>
          <Cell w="18%" bold>Supplier</Cell>
          <Cell w="60%" bold>Stages</Cell>
        </View>
        {data.matrix.map((r) => (
          <View key={r.part.id} style={s.row} wrap={false}>
            <Cell w="22%">
              {r.part.partNumber ?? "-"} {r.part.description.slice(0, 60)}
              {r.part.coverage === "possible" ? " (possible: confirm with supplier)" : ""}
            </Cell>
            <Cell w="18%">{data.supplierForPart[r.part.id] ?? r.part.supplierName ?? "-"}</Cell>
            <Cell w="60%">{r.cells.map((c) => `${STAGE_LABELS[c.stage]}: ${STATUS_LABEL[c.status]}`).join("  ·  ")}</Cell>
          </View>
        ))}

        <Text style={s.h2}>2. Accepted claims (with verbatim citations)</Text>
        {data.claims.length === 0 ? <Text style={s.muted}>No claims have been accepted yet.</Text> : null}
        {data.claims.map((c, i) => (
          <View key={c.id} style={{ marginBottom: 6 }} wrap={false}>
            <Text style={s.th}>
              C{i + 1}. {c.stage ? STAGE_LABELS[c.stage as keyof typeof STAGE_LABELS] : "Stage not stated"} · {c.facilityName ?? "Facility not named"} · {c.countryIso ?? c.country ?? "country not stated"}
              {c.coveredCountry ? "  [COVERED COUNTRY]" : ""}
            </Text>
            <Text>Supplier {c.supplierName} · Issuer {c.issuer ?? "-"} · Date {c.issueDate ? c.issueDate.toISOString().slice(0, 10) : "-"} · Document D{data.documents.findIndex((d) => d.id === c.documentId) + 1}</Text>
            {c.citations.map((q, j) => (
              <Text key={j} style={s.muted}>
                {q.field} (p.{q.page}): &ldquo;{q.quote.slice(0, 200)}&rdquo;
              </Text>
            ))}
          </View>
        ))}

        <Text style={s.h2}>3. Facility locations</Text>
        <View style={s.row}>
          <Cell w="6%" bold>#</Cell>
          <Cell w="30%" bold>Facility</Cell>
          <Cell w="16%" bold>Stage</Cell>
          <Cell w="10%" bold>Country</Cell>
          <Cell w="22%" bold>Lat, Lng</Cell>
          <Cell w="16%" bold>Flag</Cell>
        </View>
        {data.claims.map((c, i) => (
          <View key={c.id} style={s.row} wrap={false}>
            <Cell w="6%">C{i + 1}</Cell>
            <Cell w="30%">{c.facilityName ?? c.address ?? "-"}</Cell>
            <Cell w="16%">{c.stage ?? "-"}</Cell>
            <Cell w="10%">{c.countryIso ?? "-"}</Cell>
            <Cell w="22%">{c.latitude != null && c.longitude != null ? `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}` : "not geocoded"}</Cell>
            <Cell w="16%">{c.coveredCountry ? "Covered country" : "-"}</Cell>
          </View>
        ))}

        <Text style={s.h2}>4. Document register</Text>
        {data.documents.map((d, i) => (
          <View key={d.id} style={s.row} wrap={false}>
            <Cell w="6%">D{i + 1}</Cell>
            <Cell w="30%">{d.fileName}</Cell>
            <Cell w="20%">{d.supplierName}</Cell>
            <Cell w="12%">{d.uploadedAt.toISOString().slice(0, 10)}</Cell>
            <Cell w="32%">sha256 {d.sha256.slice(0, 32)}…</Cell>
          </View>
        ))}

        <Text style={s.h2}>5. Open questions</Text>
        {questions.length === 0 ? <Text style={s.muted}>None.</Text> : questions.map((q, i) => <Text key={i}>• {q}</Text>)}

        <Text style={s.h2}>6. Stated limits</Text>
        {STATED_LIMITS.map((l, i) => (
          <Text key={i}>• {l}</Text>
        ))}
        <Text style={s.disclaimer}>{PDF_DISCLAIMER}</Text>
        <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `Lodeline · ${PDF_DISCLAIMER.slice(0, 110)}… · Page ${pageNumber} of ${totalPages}`} />
      </Page>
    </Document>
  );
}

export async function renderPackPdf(data: PackPdfData): Promise<Buffer> {
  return renderToBuffer(<PackPdf data={data} />);
}
