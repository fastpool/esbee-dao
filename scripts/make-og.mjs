// Draw the social card, the one image everywhere else shows instead of the page.
//
//   pnpm run og
//
// Discord, Slack, Signal and every timeline read `og:image` and nothing else of
// the design. Without one they fall back to the title and the description, which
// is a wall of grey text next to a link -- which is exactly what the site looked
// like when shared, until this existed.
//
// Headless Chrome again, for the same reason `make-icons.mjs` uses it: the card
// is brand CSS -- a colour-mix, a mask, a webfont -- and a browser is the only
// renderer guaranteed to agree with the one the design was drawn in.
//
// Deliberately no rate on the card. `target-rate` belongs to a bond and the next
// bond may carry another, while a social image is cached by every platform that
// ever saw it: a number baked in here would go on being shown long after the
// page stopped agreeing with it. The card says what the pool *is*; the page says
// what it currently pays.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const WIDTH = 1200;
const HEIGHT = 630;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "og.png");

function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache).filter((d) => d.startsWith("chromium-"))) {
      for (const candidate of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const path = join(cache, entry, candidate);
        if (existsSync(path)) return path;
      }
    }
  }
  for (const path of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ]) {
    if (existsSync(path)) return path;
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error(
    "no Chrome found. Set CHROME=/path/to/chrome, or install one with:\n" +
      "  pnpm exec playwright install chromium",
  );
  process.exit(1);
}

// The fonts are the site's own, loaded from `styles.css` by the same relative
// paths the page uses -- so the card is drawn in the typeface the design is in
// rather than in whatever the headless browser falls back to.
const card = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="styles.css">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    background: var(--color-surface); color: var(--color-text);
    font-family: var(--font-body); position: relative;
  }
  .comb { position: absolute; inset: 0; opacity: .5;
    -webkit-mask-image: radial-gradient(115% 105% at 86% 52%, #000 26%, color-mix(in srgb, #000 18%, transparent) 66%); }
  .wrap { position: relative; height: 100%; display: grid;
    grid-template-columns: 1fr 420px; align-items: center; gap: 40px; padding: 0 72px; }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 30px; }
  .brand span { font-family: var(--font-heading); font-size: 40px; letter-spacing: -0.01em; }
  .dot { color: var(--color-accent); }
  h1 { font-family: var(--font-heading); font-size: 74px; line-height: .98;
       letter-spacing: -0.02em; margin: 0 0 22px; max-width: 13ch; }
  p { font-size: 24px; line-height: 1.42; margin: 0; max-width: 28ch;
      color: color-mix(in srgb, var(--color-text) 88%, transparent); }
  /* One row, always. A wrapped pill falls off the bottom of a fixed 630px
     card, and a social image has no scrollbar to tell anyone it happened. */
  .facts { display: flex; gap: 9px; margin-top: 30px; flex-wrap: nowrap; }
  .fact { font-size: 17px; padding: 8px 16px; border-radius: 999px;
          background: color-mix(in srgb, var(--color-accent) 15%, transparent);
          color: var(--color-accent-800); white-space: nowrap; }
  .disc { width: 420px; height: 420px; border-radius: 50%; display: grid; place-items: center;
          background: radial-gradient(circle at 34% 28%, #ffd9c2, var(--color-accent-300) 68%); }
</style></head><body>
  <svg class="comb" width="100%" height="100%" aria-hidden="true">
    <defs><pattern id="c" width="51.96" height="90" patternUnits="userSpaceOnUse">
      <g style="fill:none;stroke:var(--color-accent);stroke-width:1.3">
        <path d="M25.98 -30 L51.96 -15 L51.96 15 L25.98 30 L0 15 L0 -15 Z"/>
        <path d="M0 15 L25.98 30 L25.98 60 L0 75 L-25.98 60 L-25.98 30 Z"/>
        <path d="M51.96 15 L77.94 30 L77.94 60 L51.96 75 L25.98 60 L25.98 30 Z"/>
        <path d="M25.98 60 L51.96 75 L51.96 105 L25.98 120 L0 105 L0 75 Z"/>
      </g></pattern></defs>
    <rect width="100%" height="100%" fill="url(#c)"/>
  </svg>
  <div class="wrap">
    <div>
      <div class="brand">
        <svg width="46" height="46" viewBox="0 0 64 64">
          <path d="M32 3 L59 18 L59 46 L32 61 L5 46 L5 18 Z" style="fill:none;stroke:var(--color-text);stroke-width:3.4;stroke-linejoin:round"/>
          <ellipse cx="32" cy="38" rx="9.5" ry="13" style="fill:var(--color-accent)"/>
          <path d="M23.6 33 h16.8 M24.4 42 h15.2" style="stroke:var(--color-text);stroke-width:3.2;stroke-linecap:round"/>
          <circle cx="32" cy="24" r="5.4" style="fill:var(--color-text)"/>
        </svg>
        <span>Esbee<span class="dot">.</span></span>
      </div>
      <h1>A hive that holds the bond.</h1>
      <p>A pooled sBTC staker for pox-5 Bitcoin Staking Bonds, with the operator seat held by its own members.</p>
      <div class="facts">
        <span class="fact">sBTC + STX</span>
        <span class="fact">Rolls without unwinding</span>
        <span class="fact">Governed by its members</span>
      </div>
    </div>
    <div class="disc">
      <svg width="250" height="250" viewBox="0 0 64 64">
        <path d="M32 3 L59 18 L59 46 L32 61 L5 46 L5 18 Z" style="fill:var(--color-bg);stroke:var(--color-text);stroke-width:3.2;stroke-linejoin:round"/>
        <ellipse cx="21" cy="31" rx="9" ry="5" transform="rotate(-18 21 31)" style="fill:color-mix(in srgb, var(--color-neutral-400) 62%, transparent)"/>
        <ellipse cx="43" cy="31" rx="9" ry="5" transform="rotate(18 43 31)" style="fill:color-mix(in srgb, var(--color-neutral-400) 62%, transparent)"/>
        <ellipse cx="32" cy="39" rx="9.5" ry="13" style="fill:var(--color-accent)"/>
        <path d="M23.6 34 h16.8 M24.4 43 h15.2" style="stroke:var(--color-text);stroke-width:3.2;stroke-linecap:round"/>
        <circle cx="32" cy="24" r="5.6" style="fill:var(--color-text)"/>
      </svg>
    </div>
  </div>
</body></html>`;

// Written beside `styles.css` so the stylesheet and its fonts resolve by the
// same relative paths the site uses, then removed again -- it is a fixture, not
// a page, and a stray HTML file in the root would be copied into `dist/`.
const scratch = join(root, ".og-card.html");
writeFileSync(scratch, card);
try {
  execFileSync(chrome, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--window-size=${WIDTH},${HEIGHT}`,
    `--screenshot=${out}`,
    `file://${scratch}`,
  ], { stdio: ["ignore", "ignore", "pipe"] });
} finally {
  rmSync(scratch, { force: true });
}

const bytes = statSync(out).size;
console.log(`og.png  ${WIDTH}x${HEIGHT} @2x  ${(bytes / 1024).toFixed(0)} kB`);
// A card that failed to draw is a flat rectangle, and flat rectangles compress
// to almost nothing. The comb alone puts it well past this.
if (bytes < 20_000) {
  console.error("  that is too small to be the card -- check styles.css resolved");
  process.exit(1);
}
