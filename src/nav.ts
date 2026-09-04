// Shared site header — logo, main nav, page sub-nav, wallet and network controls.
//
// All three pages (index.html, analytics.html, app.html) render their header
// through `mountNav` so the structure lives in one place. The main nav always
// shows The Pool · Analytics · Participate; the sub-nav links are the sections
// on the current page.
//
// The header is two bars, and `styles.css` (`.site-head`) is where the layout
// lives. The top bar is who you are and where you are, and never wraps; the
// bottom bar is what this page is made of. On a phone only the top bar sticks.
import { mountInto, type Scope } from "./render.js";

export type Page = "home" | "analytics" | "participate";

interface SubLink {
  href: string;
  label: string;
}

const SUB_LINKS: Record<Page, SubLink[]> = {
  home: [
    { href: "#pool", label: "How it works" },
    { href: "#govern", label: "Governance" },
    { href: "#vote", label: "Vote" },
    { href: "#trust", label: "Trust" },
  ],
  analytics: [
    { href: "#work", label: "Open work" },
    { href: "#epochs", label: "Epochs" },
    { href: "#floor", label: "Floor" },
  ],
  participate: [],
};

function navScope(page: Page): Record<string, unknown> {
  const sub = SUB_LINKS[page];
  const current = (p: Page): string => (p === page ? "page" : "false");
  return {
    _nav: {
      // The mark on the page you are already on scrolls to the top of it.
      // Reloading the page you are looking at is a slow way to do nothing.
      brandHref: page === "home" ? "#top" : "index.html",
      poolCurrent: current("home"),
      analyticsCurrent: current("analytics"),
      participateCurrent: current("participate"),
      // A call to action on every page except the one it calls you to, where
      // it is just the name of where you are.
      participateClass: page === "participate" ? "" : "btn btn-secondary",
      hasSubNav: sub.length > 0,
      subLinks: sub,
    },
  };
}

// The header markup. Placeholders beginning with `_nav.` are resolved from the
// nav scope above; the wallet/network bindings come from the page's own scope
// so that re-renders triggered by chain reads keep the header current too.
const NAV_HTML = `
<header class="site-head">
  <div class="site-bar">
    <div class="site-bar-in">
      <a class="site-brand" href="{{ _nav.brandHref }}">
        <svg width="34" height="34" sc-camel-view-box="0 0 64 64" style="display:block;flex:none">
          <path d="M32 3 L59 18 L59 46 L32 61 L5 46 L5 18 Z" style="fill:var(--color-surface);stroke:var(--color-text);stroke-width:3.4;stroke-linejoin:round"></path>
          <ellipse cx="20" cy="26" rx="8" ry="4.4" transform="rotate(-32 20 26)" style="fill:var(--color-text);opacity:.22"></ellipse>
          <ellipse cx="44" cy="26" rx="8" ry="4.4" transform="rotate(32 44 26)" style="fill:var(--color-text);opacity:.22"></ellipse>
          <ellipse cx="32" cy="38" rx="9.5" ry="13" style="fill:var(--color-accent)"></ellipse>
          <path d="M23.6 33 h16.8 M24.4 42 h15.2" style="stroke:var(--color-text);stroke-width:3.2;stroke-linecap:round"></path>
          <circle cx="32" cy="24" r="5.4" style="fill:var(--color-text)"></circle>
        </svg>
        <span class="site-brand-name">Esbee<span style="color:var(--color-accent)">.</span></span>
      </a>
      <nav class="site-nav" aria-label="Site">
        <a href="index.html" aria-current="{{ _nav.poolCurrent }}">The Pool</a>
        <a href="analytics.html" aria-current="{{ _nav.analyticsCurrent }}">Analytics</a>
        <a href="app.html" class="{{ _nav.participateClass }}" aria-current="{{ _nav.participateCurrent }}">Participate</a>
      </nav>
      <button class="btn btn-primary site-wallet" sc-camel-on-click="{{ openWallet }}">{{ walletLabel }}</button>
    </div>
  </div>
  <!-- What this page is made of, and what it is reading: its sections, the
       network, and the vault. Two vaults exist under this DAO and they hold
       different money, so naming the contract is not decoration -- but none of
       this is navigation, and the contract name alone is twenty monospace
       characters, which is what used to push the wallet button onto a second
       line. Down here it costs nobody the top bar. -->
  <div class="site-sub">
    <div class="site-sub-in">
      <sc-if value="{{ _nav.hasSubNav }}">
        <nav class="site-sub-links" aria-label="On this page">
          <sc-for list="{{ _nav.subLinks }}" as="sl">
            <a href="{{ sl.href }}">{{ sl.label }}</a>
          </sc-for>
        </nav>
      </sc-if>
      <div class="site-ctx">
        <div class="seg">
          <sc-for list="{{ networks }}" as="n">
            <button class="seg-opt" sc-camel-on-click="{{ n.choose }}" title="{{ n.note }}" style="background:{{ n.bg }};color:{{ n.fg }};border:0;font:inherit;cursor:pointer">{{ n.label }}</button>
          </sc-for>
        </div>
        <sc-if value="{{ poolShow }}">
          <a class="tag tag-accent site-contract" href="{{ poolLink }}" target="_blank" rel="noopener" title="{{ poolContract }}">{{ poolName }} ↗</a>
        </sc-if>
      </div>
    </div>
  </div>
</header>
`;

let _tpl: HTMLTemplateElement | null = null;

function getTemplate(): HTMLTemplateElement {
  if (!_tpl) {
    _tpl = document.createElement("template");
    _tpl.innerHTML = NAV_HTML;
  }
  return _tpl;
}

/** Render the site header into `mount` for the given page, using the page's scope. */
export function mountNav(page: Page, mount: Element, scope: Scope): void {
  // Merge nav-specific bindings into a child scope so they do not collide with
  // the page's own keys (walletLabel, networks, poolShow, …).
  const combined: Scope = Object.create(scope) as Scope;
  const ns = navScope(page);
  for (const [k, v] of Object.entries(ns)) {
    (combined as Record<string, unknown>)[k] = v;
  }
  mountInto(getTemplate(), mount, combined);
}
