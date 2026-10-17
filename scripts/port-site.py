#!/usr/bin/env python3
"""Port the static lodeline.org pages (vendor/lodeline-site/*.html) into TSX.

The copy and markup are taken verbatim from the live site; the only edits are the
platform CTA patches in PATCHES below (demo, directory, pack, sign-in, suppliers)
and the interactive islands (readiness check, lead + checklist forms), which are
swapped for React components by element id. Re-run after updating vendor/:

    python3 scripts/port-site.py && npx prettier --write app/_site/pages  (optional)
"""
import html, json, os, re, sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "vendor", "lodeline-site")
OUT = os.path.join(ROOT, "app", "_site", "pages")

PAGES = {
    "home": "index.html",
    "sample-evidence-pack": "sample-evidence-pack.html",
    "privacy": "privacy.html",
    "readiness-checklist": "readiness-checklist.html",
    "industry-aerospace-assemblies": "industries_aerospace-assemblies.html",
    "industry-motors-actuators": "industries_motors-actuators.html",
    "industry-power-generation": "industries_power-generation.html",
    "industry-uas-components": "industries_uas-components.html",
}

ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
PLATFORM_LINKS = '<a class="nav-plat" href="/demo">Demo</a><a class="nav-plat" href="/suppliers">Suppliers</a>'
SIGNIN = '<a class="nav-signin" href="/login">Sign in</a>'

PLATFORM_SECTION = f'''
<!-- PLATFORM (added: links the marketing site to the Lodeline platform) -->
<section class="sec light alt" id="platform">
  <div class="wrap">
    <p class="kicker">/ Try the platform</p>
    <h2 class="display">See it on your parts.<br><em>Free to start.</em></h2>
    <div class="cards3 data-cards">
      <article class="dcard"><span class="d-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 3h10l4 4v14H5z"/><path d="M9 13h6M9 17h6M9 9h2"/></svg></span><h3>Try the free demo</h3><p>Run a sample part list through the free parts audit and see which parts are likely to contain covered magnets, tungsten or tantalum, and which stages have no document yet. No sign-up.</p><p class="plat-cta"><a class="btn" href="/demo">Try the free demo {ARROW}</a></p></article>
      <article class="dcard"><span class="d-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span><h3>Search suppliers</h3><p>Search the directory of suppliers by material, stage and country. A listing is only marked verified when it is backed by documents Lodeline has reviewed.</p><p class="plat-cta"><a class="btn btn-glass-dark" href="/suppliers">Search suppliers</a></p></article>
      <article class="dcard"><span class="d-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3M8 12h8M8 16h5"/></svg></span><h3>Get the evidence pack</h3><p>Order a stage-by-stage evidence pack for the parts your audit flags. We request documents from your suppliers, review each one, and deliver the pack as a PDF.</p><p class="plat-cta"><a class="btn btn-glass-dark" href="/pack">Get the evidence pack</a></p></article>
    </div>
    <p class="fine plat-note">Are you a magnet, alloy, separation or mining supplier? <a href="/for-suppliers">Apply to be listed as a documented source</a>.</p>
  </div>
</section>
'''

PRIVACY_PATCHES = [
    # The lead pipeline changed (Postgres + email instead of HighLevel/Web3Forms, no visit beacon).
    # Copy below must be reviewed by Yash before launch.
    ("Last updated 15 October 2026.", "Last updated 16 October 2026.", None),
    ("They are saved in our customer relationship management system (HighLevel), and the site owner is notified by text message and email so we can reply. If that system cannot be reached, the form is delivered to us by email through Web3Forms instead.",
     "They are saved in the Lodeline application database (hosted Postgres), and we are notified by email so we can reply. We also keep a one-way hash of your IP address to limit abuse; we do not keep the address itself.", None),
    ("When a call is booked, our server receives a notice that a booking happened (not your details), and the site owner gets a text alert.", "Calendly notifies us of the booking under its own terms.", None),
    ("<h2>Visit notice</h2>", "<h2>Bot protection</h2>\n    <p>Forms on this site may be protected by Cloudflare Turnstile, which receives standard browser information to tell people from automated traffic.</p>\n\n    <h2>Platform accounts and uploads</h2>\n    <p>If you use the Lodeline platform (free parts audit, evidence packs, the supplier directory or a supplier upload link), we process the files and details you submit to provide that service, and sign-in uses an essential session cookie. Uploaded parts lists and supplier documents are stored encrypted and are only visible to you, the suppliers you invite and Lodeline reviewers. Never upload drawings, controlled technical data or export-controlled information.</p>\n\n    <h2 hidden>Visit notice</h2>", "privacy-visit"),
]

PATCHES = {
    "*": [
        # Add the platform entry points to every page's main nav.
        ('<nav class="nav-links" aria-label="Main">', '<nav class="nav-links" aria-label="Main">', 'nav-links-append'),
        # Footer: platform links.
        ('<a href="/privacy">Privacy</a>', '<a href="/demo">Demo</a><a href="/suppliers">Supplier directory</a><a href="/for-suppliers">For suppliers</a><a href="/login">Sign in</a><a href="/privacy">Privacy</a>', None),
    ],
    "privacy": PRIVACY_PATCHES,
    "home": [
        ('</div>\n      <p class="cta-note">30 minutes · No obligation · No drawings or controlled data needed</p>\n      <div class="chips">',
         f'</div>\n      <p class="cta-note">30 minutes · No obligation · No drawings or controlled data needed</p>\n      <p class="hero-links"><a href="/demo">Try the free demo →</a><a href="/suppliers">Search suppliers →</a><a href="/pack">Get the evidence pack →</a></p>\n      <div class="chips">', None),
        ('<!-- CONTEXT NUMBERS -->', PLATFORM_SECTION + '\n<!-- CONTEXT NUMBERS -->', None),
        ('<a href="#faq"><span>07</span>FAQ</a>',
         '<a href="#faq"><span>07</span>FAQ</a>\n    <a href="/demo"><span>08</span>Free demo</a>\n    <a href="/suppliers"><span>09</span>Supplier directory</a>\n    <a href="/login"><span>10</span>Sign in</a>', None),
    ],
}

# Interactive islands, replaced by id with React components (imported per page).
ISLANDS = {
    "quiz": ("ReadinessCheck", "../readiness-check"),
    "lead": ("LeadForm", "../lead-form"),
    "magnet": ("ChecklistForm", "../checklist-form"),
    "cal-slot": (None, None),  # rendered by LeadForm
}

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
NO_WS = {"table", "thead", "tbody", "tfoot", "tr", "colgroup", "select", "html", "head"}
ATTR = {
    "class": "className", "for": "htmlFor", "tabindex": "tabIndex", "autocomplete": "autoComplete",
    "maxlength": "maxLength", "minlength": "minLength", "novalidate": "noValidate", "readonly": "readOnly",
    "colspan": "colSpan", "rowspan": "rowSpan", "datetime": "dateTime", "crossorigin": "crossOrigin",
    "viewbox": "viewBox", "preserveaspectratio": "preserveAspectRatio", "srcset": "srcSet",
    "enctype": "encType", "accesskey": "accessKey", "contenteditable": "contentEditable",
    "xlink:href": "xlinkHref", "inputmode": "inputMode", "spellcheck": "spellCheck",
    "checked": "defaultChecked", "fetchpriority": "fetchPriority",
}


def camel(name):
    if name.startswith(("aria-", "data-")):
        return name
    if name in ATTR:
        return ATTR[name]
    return re.sub(r"-([a-z])", lambda m: m.group(1).upper(), name)


def jsx_str(v):
    if any(c in v for c in '"\\{}&<>') or "\n" in v:
        return "{" + json.dumps(v, ensure_ascii=False) + "}"
    return '"' + v + '"'


def style_obj(s):
    parts = []
    for decl in s.split(";"):
        if ":" not in decl:
            continue
        k, v = decl.split(":", 1)
        k, v = k.strip(), v.strip()
        key = k if k.startswith("--") else re.sub(r"-([a-z])", lambda m: m.group(1).upper(), k)
        parts.append(f"{json.dumps(key)}: {json.dumps(v)}")
    return "{{" + ", ".join(parts) + "} as React.CSSProperties}"


class Conv(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.stack = []  # tag names
        self.skip = 0  # depth inside a skipped subtree
        self.in_body = False
        self.body_class = ""
        self.islands = set()

    def emit(self, s):
        if self.in_body and not self.skip:
            self.out.append(s)

    def attrs_jsx(self, tag, attrs):
        out = []
        for k, v in attrs:
            if tag == "option" and k == "selected":
                continue
            name = camel(k)
            if v is None:
                out.append(name)
            elif k == "style":
                out.append(f"style={style_obj(v)}")
            else:
                if k in ("src", "href") and v.startswith("assets/"):
                    v = "/" + v
                out.append(f"{name}={jsx_str(v)}")
        return (" " + " ".join(out)) if out else ""

    def handle_starttag(self, tag, attrs, selfclose=False):
        a = dict(attrs)
        if tag == "body":
            self.in_body = True
            self.body_class = a.get("class") or ""
            return
        if not self.in_body:
            return
        if self.skip:
            if tag not in VOID and not selfclose:
                self.skip += 1
            return
        if tag in ("script", "noscript"):
            self.skip = 1
            return
        if a.get("id") in ISLANDS:
            comp, mod = ISLANDS[a["id"]]
            if comp:
                self.islands.add(a["id"])
                self.out.append(f"<{comp} />")
            if tag not in VOID and not selfclose:
                self.skip = 1
            return
        extra = ""
        if tag == "select":
            extra = ' defaultValue=""'
        s = f"<{tag}{self.attrs_jsx(tag, attrs)}{extra}"
        if tag in VOID or selfclose:
            self.emit(s + " />")
        else:
            self.emit(s + ">")
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs, selfclose=True)

    def handle_endtag(self, tag):
        if tag == "body":
            self.in_body = False
            return
        if not self.in_body or tag in VOID:
            return
        if self.skip:
            self.skip -= 1
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
            self.emit(f"</{tag}>")

    def handle_data(self, data):
        if not self.in_body or self.skip:
            return
        parent = self.stack[-1] if self.stack else "body"
        if not data.strip():
            if parent not in NO_WS and self.stack:
                self.emit('{" "}')
            return
        if parent in NO_WS:
            data = data.strip()
        lead = " " if data[0].isspace() else ""
        trail = " " if data[-1].isspace() else ""
        core = re.sub(r"\s+", " ", data.strip())
        if any(c in core for c in "{}<>&"):
            body = "{" + json.dumps(core, ensure_ascii=False) + "}"
        else:
            body = core
        self.emit(('{" "}' if lead else "") + body + ('{" "}' if trail else ""))

    def handle_comment(self, data):
        self.emit("{/* " + data.strip().replace("*/", "* /") + " */}")


def patch(name, src):
    for find, repl, mode in PATCHES["*"] + PATCHES.get(name, []):
        if find not in src:
            if mode is None and name == "home" or find.startswith("<nav class"):
                print(f"[{name}] patch not applied: {find[:60]!r}", file=sys.stderr)
            continue
        if mode == "privacy-visit":
            src = src.replace(find, repl, 1)
            # Drop the visit-notice paragraph: the visitor beacon is not ported.
            src = re.sub(r'<h2 hidden>Visit notice</h2>\s*<p>.*?</p>\s*', "", src, count=1, flags=re.S)
            continue
        if mode == "nav-links-append":
            src = re.sub(r'(<nav class="nav-links" aria-label="Main">.*?)(</nav>)', r"\1" + PLATFORM_LINKS + r"\2", src, count=1, flags=re.S)
            src = re.sub(r'(<a class="btn btn-pill)', SIGNIN + r"\1", src, count=1)
        else:
            src = src.replace(find, repl, 1)
    return src


def convert(name, file):
    src = open(os.path.join(SRC, file), encoding="utf-8").read()
    src = patch(name, src)
    c = Conv()
    c.feed(src)
    body = "".join(c.out)
    imports = ['import type React from "react";', 'import { SiteBehaviors } from "../site-behaviors";']
    for i in sorted(c.islands):
        comp, mod = ISLANDS[i]
        imports.append(f'import {{ {comp} }} from "{mod}";')
    cls = ("ll-site " + c.body_class).strip()
    title = html.unescape(re.search(r"<title>(.*?)</title>", src, re.S).group(1).strip())
    dm = re.search(r'<meta name="description" content="([^"]*)"', src)
    desc = html.unescape(dm.group(1)) if dm else ""
    om = re.search(r'<meta property="og:image" content="https?://[^/]+([^"]*)"', src)
    meta = {"title": title, "description": desc, "ogImage": om.group(1) if om else "/assets/img/hero-magnetic-field.jpg"}
    code = (
        "// GENERATED by scripts/port-site.py from vendor/lodeline-site/" + file + ". Do not edit by hand.\n"
        "/* eslint-disable */\n" + "\n".join(imports) + "\n\n"
        + "export const meta = " + json.dumps(meta, ensure_ascii=False, indent=2) + ";\n\n"
        f"export default function Markup() {{\n  return (\n    <div className={json.dumps(cls)}>\n"
        + body + "\n      <SiteBehaviors />\n    </div>\n  );\n}\n"
    )
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name + ".tsx"), "w", encoding="utf-8") as f:
        f.write(code)
    print(f"{name}: {len(code)} bytes, islands={sorted(c.islands)}")


def copy_css():
    """Copy the site stylesheets, making relative asset urls absolute (/assets/...)."""
    for name in ("site.css", "pack.css"):
        css = open(os.path.join(SRC, name), encoding="utf-8").read()
        css = re.sub(r"url\((['\"]?)(?!data:|https?:|/)([^)'\"]+)\1\)", lambda m: f"url({m.group(1)}/assets/{m.group(2)}{m.group(1)})", css)
        with open(os.path.join(ROOT, "app", "_site", name), "w", encoding="utf-8") as f:
            f.write("/* GENERATED by scripts/port-site.py from vendor/lodeline-site/" + name + " (lodeline.org). */\n" + css)


if __name__ == "__main__":
    for n, f in PAGES.items():
        convert(n, f)
    copy_css()
