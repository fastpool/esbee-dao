// Rasterise `esbee.svg` into the PNG sizes an SVG favicon does not cover.
//
//   pnpm run icons
//
// Headless Chrome is the rasteriser. It is not an extra dependency: Playwright
// already ships one for the screenshot script, and a browser is the only
// renderer guaranteed to agree with what a browser will actually draw --
// librsvg and resvg both support a different subset of CSS, and this mark
// carries a `<style>` block with a `prefers-color-scheme` query.
//
// The PNGs are the light-theme mark. A PNG cannot switch with the reader's
// theme; the SVG favicon does that, and these are the fallback for the places
// that will not take one -- older Safari, Windows tiles, apple-touch-icon.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const SIZES = [32, 180, 512];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "esbee.svg");
const out = join(root, "icons");

/** Chrome, from the environment or wherever Playwright put it. */
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

mkdirSync(out, { recursive: true });

for (const size of SIZES) {
  const file = join(out, `icon-${size}.png`);
  execFileSync(chrome, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    // Without this the mark lands on white, which shows as a card behind it.
    "--default-background-color=00000000",
    `--window-size=${size},${size}`,
    `--screenshot=${file}`,
    `file://${source}`,
  ], { stdio: ["ignore", "ignore", "pipe"] });

  // An invalid SVG still screenshots -- as Chrome's XML error page. Size is the
  // cheap tell: the error page is far larger than the mark at these dimensions.
  const bytes = statSync(file).size;
  console.log(`icons/icon-${size}.png  ${bytes} bytes`);
  if (size <= 64 && bytes > 8000) {
    console.error(
      `  that is too big for a ${size}px mark -- check that esbee.svg is valid XML`,
    );
    process.exit(1);
  }
}
