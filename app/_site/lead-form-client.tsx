"use client";
import { useState } from "react";
import { EMAIL_RE, SUPPLIES_OPTIONS } from "@/services/lead-rules";
import { postLead, Turnstile } from "./turnstile";

const ARROW = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const CAL = /^https:\/\/calendly\.com\/[A-Za-z0-9_\-/]+$/;

type Out = { cls: string; text: string } | null;

function firstInvalid(form: HTMLFormElement, names: string[]): HTMLInputElement | null {
  let bad: HTMLInputElement | null = null;
  for (const n of names) {
    const el = form.elements.namedItem(n) as HTMLInputElement;
    const v = (el.value || "").trim();
    const ok = v !== "" && (n !== "email" || EMAIL_RE.test(v));
    el.setAttribute("aria-invalid", ok ? "false" : "true");
    if (!ok && !bad) bad = el;
  }
  return bad;
}

/** Readiness-call request form (contact section): Postgres lead + email notification. */
export function LeadFormClient({ turnstileSiteKey, calendlyUrl }: { turnstileSiteKey?: string; calendlyUrl?: string }) {
  const [out, setOut] = useState<Out>(null);
  const [busy, setBusy] = useState(false);
  const cal = calendlyUrl && CAL.test(calendlyUrl) ? calendlyUrl : null;

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const bad = firstInvalid(form, ["name", "company", "email", "supplies"]);
    if (bad) {
      setOut({
        cls: "form-out err",
        text: bad.name === "email" ? "Please enter a valid work email." : bad.name === "supplies" ? "Please select what you supply." : "Please fill in your name and company.",
      });
      bad.focus();
      return;
    }
    if ((form.elements.namedItem("botcheck") as HTMLInputElement).checked) return;
    setBusy(true);
    setOut({ cls: "form-out", text: "Sending…" });
    try {
      await postLead("/api/leads", form, { kind: "readiness_call" });
      form.reset();
      setOut({ cls: "form-out ok", text: "Thank you. Your request has been received and we will reply by email." });
    } catch (e) {
      const err = e as Error & { status?: number };
      setOut({
        cls: "form-out err",
        text: err.status === 400 || err.status === 429 ? err.message : "Sorry, your request could not be sent. Please try again in a few minutes.",
      });
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form className="form glass" id="lead" noValidate onSubmit={onSubmit}>
      <p className="form-warn" id="lead-warn">
        <b>Please do not include controlled technical data, drawings, contract files, sensitive supplier information, or export-controlled information.</b>
      </p>
      <div className="row">
        <label htmlFor="f-name">
          Name
          <input id="f-name" name="name" required autoComplete="name" maxLength={100} />
        </label>
        <label htmlFor="f-company">
          Company
          <input id="f-company" name="company" required autoComplete="organization" maxLength={200} />
        </label>
      </div>
      <div className="row">
        <label htmlFor="f-email">
          Work email
          <input id="f-email" name="email" type="email" required autoComplete="email" maxLength={200} />
        </label>
        <label htmlFor="f-phone">
          <span>
            Phone <small>(optional)</small>
          </span>
          <input id="f-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </label>
      </div>
      <label htmlFor="f-supplies">
        What do you supply?
        <select id="f-supplies" name="supplies" required defaultValue="">
          <option value="" disabled>
            Select an option
          </option>
          {SUPPLIES_OPTIONS.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
      <label htmlFor="f-message">
        <span>
          Anything we should know? <small>(optional)</small>
        </span>
        <textarea
          id="f-message"
          name="message"
          rows={3}
          maxLength={1500}
          aria-describedby="lead-warn"
          placeholder="e.g. a customer has asked about magnet origin for two motor part numbers"
        />
      </label>
      <div className="hp" aria-hidden="true">
        <label htmlFor="f-botcheck">
          Leave this empty
          <input type="checkbox" id="f-botcheck" name="botcheck" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <Turnstile siteKey={turnstileSiteKey} />
      <button className="btn btn-lg" type="submit" disabled={busy}>
        Request a readiness call {ARROW}
      </button>
      <p className={out?.cls ?? "form-out"} id="lead-out" role="status" aria-live="polite">
        {out?.text}
      </p>
      <p className="fine">
        Text only; no file uploads. See our <a href="/privacy">privacy notice</a> for how form details are handled.
      </p>
    </form>
  );

  if (!cal) return form;
  const src = `${cal}?embed_type=Inline&hide_gdpr_banner=1&background_color=ffffff&primary_color=c4783f`;
  return (
    <>
      <div className="cal-slot" id="cal-slot">
        <iframe title="Book a readiness call" src={src} loading="lazy" />
      </div>
      <details className="alt-form">
        <summary>Prefer to send a message instead?</summary>
        {form}
      </details>
    </>
  );
}

/** Checklist download (lead magnet): email + company, then the checklist + PDF links. */
export function ChecklistFormClient({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [out, setOut] = useState<{ cls: string; text?: string; done?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const bad = firstInvalid(form, ["email", "company"]);
    if (bad) {
      setOut({ cls: "form-out err", text: bad.name === "email" ? "Please enter a valid work email." : "Please enter your company." });
      bad.focus();
      return;
    }
    if ((form.elements.namedItem("botcheck") as HTMLInputElement).checked) return;
    setBusy(true);
    setOut({ cls: "form-out", text: "Sending…" });
    try {
      await postLead("/api/leads", form, { kind: "checklist" });
      form.reset();
      setOut({ cls: "form-out ok", done: true });
    } catch (e) {
      const err = e as Error & { status?: number };
      setOut({ cls: "form-out err", text: err.status === 400 || err.status === 429 ? err.message : "Sorry, that did not go through. Please try again in a few minutes." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form magnet glass-light" id="magnet" noValidate onSubmit={onSubmit}>
      <p className="mono-lbl">Free download</p>
      <label htmlFor="m-email">
        Work email
        <input id="m-email" name="email" type="email" required autoComplete="email" maxLength={200} />
      </label>
      <label htmlFor="m-company">
        Company
        <input id="m-company" name="company" required autoComplete="organization" maxLength={200} />
      </label>
      <div className="hp" aria-hidden="true">
        <label htmlFor="m-botcheck">
          Leave this empty
          <input type="checkbox" id="m-botcheck" name="botcheck" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <Turnstile siteKey={turnstileSiteKey} />
      <button className="btn btn-lg" type="submit" disabled={busy}>
        Get the checklist {ARROW}
      </button>
      <p className={out?.cls ?? "form-out"} id="magnet-out" role="status" aria-live="polite">
        {out?.done ? (
          <>
            Thank you. <a href="/readiness-checklist">Open the checklist</a> or{" "}
            <a href="/assets/lodeline-readiness-checklist.pdf" download>
              download the PDF
            </a>
            .
          </>
        ) : (
          out?.text
        )}
      </p>
      <p className="fine">
        We only use your email to follow up about the checklist. See our <a href="/privacy">privacy notice</a>.
      </p>
    </form>
  );
}
