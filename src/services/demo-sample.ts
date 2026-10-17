/**
 * Fictional sample parts list for the public /demo. Every part number and
 * supplier is invented. Runs through the real free-audit pipeline.
 */
/** Reserved, undeliverable (RFC 2606) address recorded on demo audits; demo results are never emailed. */
export const DEMO_LEAD_EMAIL = "demo@example.invalid";

export const DEMO_FILE_NAME = "lodeline-demo-parts-list.csv";

export const DEMO_PARTS_CSV = [
  "Part Number,Description,Supplier",
  "EM-1001,Rotor magnet assembly NdFeB N42SH arc segments,Example Magnet Supplier A (fictional)",
  "EM-2040,Position sensor with SmCo 2:17 magnet,Example Sensor Co (fictional)",
  "EM-3310,Brake actuator brushless DC motor 48V,Example Motion Supplier C (fictional)",
  "EM-4100,Tantalum capacitor 47uF 25V for drive board,Example Electronics (fictional)",
  "EM-5200,Tungsten balance weight for rotor,Example Metals (fictional)",
  "EM-6001,Aluminium housing 6061-T6 machined,Example Machining (fictional)",
  "EM-6002,Stainless fastener kit M4 A2,Example Fasteners (fictional)",
  "EM-7300,Stepper motor NEMA 17 permanent magnet,Example Motion Supplier C (fictional)",
].join("\n") + "\n";

export function demoCsvBytes(): Uint8Array {
  return new TextEncoder().encode(DEMO_PARTS_CSV);
}
