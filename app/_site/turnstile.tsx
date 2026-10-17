"use client";
import Script from "next/script";

/** Cloudflare Turnstile widget (implicit render). Renders nothing when no site key is configured. */
export function Turnstile({ siteKey }: { siteKey?: string }) {
  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" style={{ margin: "6px 0 14px" }} />
    </>
  );
}

export async function postLead(url: string, form: HTMLFormElement, extra: Record<string, string>) {
  const fd = new FormData(form);
  const data: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k === "cf-turnstile-response") continue;
    if (k in data) data[k] = ([] as unknown[]).concat(data[k], String(v).trim());
    else data[k] = String(v).trim();
  }
  const token = fd.get("cf-turnstile-response");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...data, ...extra, sourcePath: window.location.pathname, turnstileToken: token ? String(token) : undefined }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; field?: string } };
  if (!res.ok) throw Object.assign(new Error(body.error?.message ?? `HTTP ${res.status}`), { status: res.status, field: body.error?.field });
  (window as unknown as { turnstile?: { reset: () => void } }).turnstile?.reset();
  return body;
}
