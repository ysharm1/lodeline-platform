import React from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";

/** Build a real PDF whose pages contain the given lines (one Text per line). */
export async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const buf = await renderToBuffer(
    <Document>
      {pages.map((lines, i) => (
        <Page key={i} size="LETTER" style={{ padding: 40, fontSize: 11 }}>
          {lines.map((l, j) => (
            <Text key={j}>{l}</Text>
          ))}
        </Page>
      ))}
    </Document>
  );
  return new Uint8Array(buf);
}
