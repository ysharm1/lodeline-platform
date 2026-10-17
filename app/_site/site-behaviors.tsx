"use client";
/**
 * Port of lodeline.org assets/site.js page chrome: frosted nav on scroll, mobile
 * menu sheet, reveal-on-scroll, phone sticky "Book" bar, floating button, and
 * the print button on the sample pack / checklist. The original visitor-alert
 * beacon (third-party CRM) is intentionally NOT ported; leads now go to
 * Postgres via /api/leads.
 */
import { useEffect } from "react";

export function SiteBehaviors() {
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const on = <K extends keyof WindowEventMap>(t: Window | Document | HTMLElement, ev: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opts);
      cleanups.push(() => t.removeEventListener(ev, fn as EventListener, opts));
    };

    const nav = document.getElementById("nav");
    const fab = document.querySelector<HTMLElement>(".fab");
    const contact = document.getElementById("contact");
    const onScroll = () => {
      if (!nav) return;
      nav.classList.toggle("solid", !document.querySelector(".hero") || window.scrollY > window.innerHeight * 0.6);
      if (fab && contact) {
        const r = contact.getBoundingClientRect();
        fab.classList.toggle("hide", window.scrollY < 300 || (r.top < window.innerHeight && r.bottom > 0));
      }
    };
    on(window, "scroll", onScroll, { passive: true });
    onScroll();

    const btn = document.getElementById("menu-btn");
    const sheet = document.getElementById("sheet");
    if (btn && sheet) {
      const setMenu = (open: boolean) => {
        sheet.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
        btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        document.body.style.overflow = open ? "hidden" : "";
        if (open) {
          nav?.classList.add("solid");
          sheet.querySelector<HTMLAnchorElement>("a")?.focus();
        } else onScroll();
      };
      on(btn, "click", () => setMenu(sheet.hidden));
      on(sheet, "click", (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest("a")) setMenu(false);
      });
      on(document, "keydown", (e: KeyboardEvent) => {
        if (e.key === "Escape" && !sheet.hidden) {
          setMenu(false);
          btn.focus();
        }
      });
      cleanups.push(() => (document.body.style.overflow = ""));
    }

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const targets = document.querySelectorAll<HTMLElement>(".sec .display, .pcard, .num, .flow, .gcard, .steps li, .pack, .tile, .dcard, .plan, .faq");
    if ("IntersectionObserver" in window && !reduce) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return;
            e.target.classList.add("in");
            io.unobserve(e.target);
          });
        },
        { threshold: 0.12 }
      );
      targets.forEach((t, i) => {
        t.classList.add("reveal");
        t.style.transitionDelay = (i % 3) * 80 + "ms";
        io.observe(t);
      });
      cleanups.push(() => io.disconnect());
    }

    const sticky = document.getElementById("sticky-book");
    if (sticky) {
      const onStick = () => {
        const c = document.getElementById("contact");
        const r = c?.getBoundingClientRect();
        const near = !!r && r.top < window.innerHeight && r.bottom > 0;
        sticky.classList.toggle("show", window.scrollY > 500 && !near);
      };
      on(window, "scroll", onStick, { passive: true });
      onStick();
    }

    const print = document.getElementById("print-btn");
    if (print) on(print, "click", () => window.print());

    return () => cleanups.forEach((f) => f());
  }, []);
  return null;
}
