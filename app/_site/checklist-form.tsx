import { ChecklistFormClient } from "./lead-form-client";

export function ChecklistForm() {
  return <ChecklistFormClient turnstileSiteKey={process.env.TURNSTILE_SITE_KEY} />;
}
