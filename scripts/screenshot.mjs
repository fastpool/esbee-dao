// Render the site in a real browser and write PNGs to `shots/`.
//
//   pnpm run shot                  # the whole page, plus the panels
//   pnpm run shot -- --width 480   # narrow, to check the layout folds
//
// Why a browser and not the DOM the tests use: `smoke-test.ts` proves the
// markup resolves, but it cannot see. A missing `viewBox`, a `style-hover` that
// never became CSS, an SVG that fails to parse -- all render as valid markup
// and look wrong only when something draws them.
//
// Chrome comes from Playwright's cache if it is there, or CHROME=. It needs no
// system packages beyond what that download brings.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};

const WIDTH = flag("width", 1180);
const HEIGHT = flag("height", 2400);
const PORT = flag("port", 8123);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "shots");

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
  for (const path of ["/usr/bin/chromium", "/usr/bin/google-chrome-stable"]) {
    if (existsSync(path)) return path;
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error("no Chrome found. Set CHROME=, or: pnpm exec playwright install chromium");
  process.exit(1);
}

// `dist/` rather than the repo: that is what gets deployed, and the pages there
// point at the hashed bundle. Served rather than opened from disk, because the
// page loads ES modules and a file:// origin refuses those.
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: join(root, "dist"),
  stdio: "ignore",
});
const stop = () => server.kill();
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(1); });

const ready = async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/index.html`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the local server never came up");
};

await ready();
mkdirSync(out, { recursive: true });

// The retired vault's page is a page of this site like any other, and the one
// most likely to be forgotten when something about the design changes. The
// keeper's page is the other: it is nobody's landing page, so nothing else
// would catch it going wrong.
for (const page of ["index.html", "media-kit.html", "analytics.html", "v1/index.html"]) {
  const file = join(out, `${page.replace(".html", "").replace("/", "-")}.png`);
  execFileSync(chrome, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    `--window-size=${WIDTH},${HEIGHT}`,
    // The page renders after its module loads and then reads the chain; without
    // a budget the shot catches an empty mount.
    "--virtual-time-budget=8000",
    `--screenshot=${file}`,
    `http://127.0.0.1:${PORT}/${page}`,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  console.log(`shots/${page.replace(".html", "").replace("/", "-")}.png  ${WIDTH}x${HEIGHT}`);
}

stop();
