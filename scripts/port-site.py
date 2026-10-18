#!/usr/bin/env python3
"""Port the static lodeline.org pages (vendor/lodeline-site/*.html) into TSX.

The copy, layout, links and markup are taken verbatim from the live site (1:1,
no redesign or rewording). The only substitution is the interactive islands
(readiness check, lead + checklist forms), which are swapped by element id for
React components that render the same markup. Re-run after updating vendor/:

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

# No copy, layout or link patches: the port is a faithful 1:1 copy of lodeline.org
# (Yash, 17 Oct 2026). New platform pages live outside these files.
PATCHES = {}

# Owner-approved ADDITIONS (18 Oct 2026, docs/business-model.md). These insert
# new elements next to existing ones; nothing on the live page is changed or
# removed. Every added element carries data-ll-added="<reason>", and
# app/_site/site.test.ts strips those elements before checking that the rest
# of the page still matches lodeline.org word for word.
#   page -> [(existing HTML to insert after, HTML to insert)]
ADDITIONS = {
    "home": [
        (
            '<a class="btn btn-lg btn-glass" href="/sample-evidence-pack">View a sample evidence pack</a>',
            '\n        <a class="btn btn-lg btn-glass" href="/audit" data-ll-added="free-audit">Run a free parts audit</a>',
        ),
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
    for anchor, insert in ADDITIONS.get(name, []):
        if src.count(anchor) != 1:
            sys.exit(f"{name}: addition anchor not found exactly once: {anchor[:60]}")
        src = src.replace(anchor, anchor + insert)
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
