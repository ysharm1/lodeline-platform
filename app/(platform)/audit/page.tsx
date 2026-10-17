import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Free parts audit</h1>
      <p className="text-muted max-w-2xl">
        Columns we look for: part number, MPN, description, material, manufacturer, supplier, notes, quantity (common
        header names are recognised). Each part is sorted into likely covered (NdFeB or SmCo magnets, tungsten or
        tantalum), possible: confirm with supplier, or likely not covered, with the rule or column behind it, and we list
        the upstream stages that have no supplier document yet.
      </p>
      <div className="rounded border border-gap/50 bg-gap/10 p-4 text-sm max-w-2xl">
        Parts lists only. Do not upload drawings, CAD files, PDFs, images, controlled technical data or
        export-controlled (ITAR/CUI) information. Those file types are rejected.
      </div>
      <UploadForm turnstileSiteKey={process.env.TURNSTILE_SITE_KEY} />
    </div>
  );
}
