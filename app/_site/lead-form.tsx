import { LeadFormClient } from "./lead-form-client";

/** Server wrapper: reads public config (Turnstile site key, Calendly link) at request time. */
export function LeadForm() {
  return <LeadFormClient turnstileSiteKey={process.env.TURNSTILE_SITE_KEY} calendlyUrl={process.env.CALENDLY_URL ?? "https://calendly.com/lodeline-info/30min"} />;
}
