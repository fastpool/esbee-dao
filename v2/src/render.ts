// The template runtime.
//
// index.html holds the design verbatim, `sc-for` / `sc-if` / `{{ }}` and all.
// Rather than expand those into static HTML, this implements exactly the four
// directives the design uses, so the markup keeps diffing cleanly against the
// canvas it came from. A framework would be more than this page needs.

/** What a template can read: whatever the view model put in scope. */
export type Scope = Record<string, unknown>;

const SVG_NS = "http://www.w3.org/2000/svg";

// The numeric values rather than `Node.ELEMENT_NODE`: the global `Node` exists
// in a browser but not in the DOM implementation the tests render through, and
// these constants have been fixed since DOM Level 1.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * `sc-camel-view-box` -> `viewBox`.
 *
 * HTML lower-cases attribute names, so the canvas escapes the ones SVG needs in
 * camelCase. Passing them through verbatim leaves an `<svg>` with no `viewBox`
 * at all: the artwork keeps its user-space size and gets clipped, which reads as
 * a broken logo rather than as a missing attribute.
 */
const camelAttr = (name: string): string =>
  name
    .slice("sc-camel-".length)
    .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** The same rewrite over raw markup, for the SVG subtrees re-parsed as a string. */
const uncamel = (markup: string): string =>
  markup.replace(/\bsc-camel-([a-z-]+)=/g, (_, rest: string) => `${camelAttr(`sc-camel-${rest}`)}=`);

const hoverRules = new Map<string, string>();

/** One class per distinct hover declaration, injected once. */
function hoverClass(declaration: string, doc: Document): string {
  const existing = hoverRules.get(declaration);
  if (existing) return existing;

  const name = `hv-${hoverRules.size}`;
  hoverRules.set(declaration, name);

  let sheet = doc.getElementById("hover-styles");
  if (!sheet) {
    sheet = doc.createElement("style");
    sheet.id = "hover-styles";
    (doc.head ?? doc.documentElement).appendChild(sheet);
  }
  sheet.textContent += `.${name}:hover{${declaration}}\n`;
  return name;
}

/** `p.tone.bg`, `sel`, `true` -- the whole expression language the design uses. */
export function evaluate(expr: string | null, scope: Scope): unknown {
  const path = String(expr ?? "").replace(/[{}]/g, "").trim();
  if (path === "true") return true;
  if (path === "false") return false;

  let value: unknown = scope;
  for (const part of path.split(".")) {
    if (value == null) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function interpolate(text: string, scope: Scope): string {
  return text.replace(/\{\{([^}]*)\}\}/g, (_, expr: string) => {
    const value = evaluate(expr, scope);
    return value == null ? "" : String(value);
  });
}

export function renderChildren(
  node: ParentNode,
  scope: Scope,
  doc: Document = document,
): Node[] {
  const out: Node[] = [];
  for (const child of Array.from(node.childNodes)) {
    out.push(...renderNode(child, scope, doc));
  }
  return out;
}

export function renderNode(
  node: Node,
  scope: Scope,
  doc: Document = document,
): Node[] {
  if (node.nodeType === TEXT_NODE) {
    return [doc.createTextNode(interpolate(node.nodeValue ?? "", scope))];
  }
  if (node.nodeType !== ELEMENT_NODE) return [];

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "sc-for") {
    const list = evaluate(el.getAttribute("list"), scope);
    const as = el.getAttribute("as") ?? "item";
    const out: Node[] = [];
    for (const item of Array.isArray(list) ? list : []) {
      // A prototype link rather than a copy: an inner scope still sees the
      // outer one, which is what `{{ closeDetail }}` inside a loop relies on.
      const inner: Scope = Object.create(scope);
      inner[as] = item;
      out.push(...renderChildren(el, inner, doc));
    }
    return out;
  }

  if (tag === "sc-if") {
    return evaluate(el.getAttribute("value"), scope)
      ? renderChildren(el, scope, doc)
      : [];
  }

  // SVG cannot be rebuilt with createElement -- the namespace would be wrong
  // and the icon would not paint. Interpolate the markup and let the parser
  // put it back in the right namespace.
  if (el.namespaceURI === SVG_NS) {
    const holder = doc.createElement("template");
    holder.innerHTML = uncamel(interpolate(el.outerHTML, scope));
    return Array.from(holder.content.childNodes);
  }

  const out = doc.createElement(tag);
  for (const attr of Array.from(el.attributes)) {
    // `style-hover` is a canvas affordance -- a browser ignores it, and the
    // hover states the design drew would just be missing. Turn each distinct
    // declaration into a real rule once, and hang a class off it.
    if (attr.name === "style-hover") {
      out.classList.add(hoverClass(interpolate(attr.value, scope), doc));
      continue;
    }
    if (attr.name === "sc-camel-on-click") {
      const handler = evaluate(attr.value, scope);
      if (typeof handler === "function") {
        out.addEventListener("click", handler as EventListener);
      }
      continue;
    }
    // Any other `sc-camel-*` is an attribute the canvas had to spell in kebab.
    if (attr.name.startsWith("sc-camel-")) {
      out.setAttribute(camelAttr(attr.name), interpolate(attr.value, scope));
      continue;
    }
    // Canvas-only hints about how many placeholders to draw while editing.
    if (attr.name.startsWith("hint-")) continue;
    out.setAttribute(attr.name, interpolate(attr.value, scope));
  }
  for (const child of renderChildren(el, scope, doc)) out.appendChild(child);
  return [out];
}

/** Render `template` into `mount`, holding the scroll position. */
export function mountInto(
  template: HTMLTemplateElement,
  mount: Element,
  scope: Scope,
  win: Window = window,
  doc: Document = document,
): void {
  const scrolled = win.scrollY ?? 0;
  const next = doc.createDocumentFragment();
  for (const child of renderChildren(template.content, scope, doc)) {
    next.appendChild(child);
  }
  mount.replaceChildren(next);
  // A full re-render would otherwise jump the page to the top on every vote.
  win.scrollTo?.({ top: scrolled, behavior: "instant" });
}
