/** Client-safe constants shared by the lead forms and LeadService. */
export const SUPPLIES_OPTIONS = [
  "Motors / actuators",
  "Sensors / instrumentation",
  "Audio / communications",
  "UAS / drone components",
  "Aerospace / propulsion",
  "Electronics assemblies",
  "Other",
] as const;

/** Same rule as the live site's form validation. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
