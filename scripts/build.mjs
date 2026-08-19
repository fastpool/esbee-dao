// Assemble `dist/` -- everything the site needs and nothing else.
//
//   pnpm run build
//
// esbuild bundles the TypeScript; the rest is a copy. The point of gathering it
// is deployment: a host is pointed at one directory, and `dist/` holds the
// pages, the mark, the fonts and the JavaScript with none of the sources,
// node_modules or test files around them.
//
// Every emitted file carries a content hash, the entry included, so the whole
// of `dist/*.js` can be cached forever: a change produces a different name. The
// pages name `app.js`; the copies in `dist/` are rewritten to whatever the
// build actually produced.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");

const PAGES = ["index.html", "media-kit.html"];
const FILES = ["styles.css", "esbee.svg"];
const DIRS = ["fonts", "icons"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. the bundle. Split, so the wallet SDK stays out of the initial load.
execFileSync(
  join(root, "node_modules", "esbuild", "bin", "esbuild"),
  [
    join(root, "src", "app.ts"),
    "--bundle",
    "--splitting",
    "--format=esm",
    "--target=es2022",
    `--outdir=${out}`,
    "--sourcemap",
    "--minify",
    // Hash the entry too. Without this `app.js` is the one file a host cannot
    // cache immutably, and getting that rule wrong pins a stale bundle on
    // every returning visitor.
    "--entry-names=[name]-[hash]",
  ],
  { stdio: "inherit" },
);

// 2. the static files, verbatim.
for (const file of FILES) cpSync(join(root, file), join(out, file));
for (const dir of DIRS) cpSync(join(root, dir), join(out, dir), { recursive: true });

// 3. the pages, pointed at the bundle that was actually built.
const entry = readdirSync(out).find((f) => /^app-[A-Z0-9]+\.js$/.test(f));
if (!entry) {
  console.error("no hashed entry in dist/ -- did esbuild change its naming?");
  process.exit(1);
}
for (const page of PAGES) {
  const html = readFileSync(join(root, page), "utf8");
  const rewritten = html.replaceAll('src="app.js"', `src="${entry}"`);
  if (html.includes('src="app.js"') && rewritten === html) {
    console.error(`${page}: could not rewrite the script path`);
    process.exit(1);
  }
  writeFileSync(join(out, page), rewritten);
}

// A page still naming the unhashed entry would 404 for every visitor while
// looking fine in the repo, so it is worth failing the build here.
for (const page of PAGES) {
  if (readFileSync(join(out, page), "utf8").includes('src="app.js"')) {
    console.error(`dist/${page} still points at an unhashed app.js`);
    process.exit(1);
  }
}

const bytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) =>
      n + (e.isDirectory() ? bytes(join(dir, e.name)) : statSync(join(dir, e.name)).size),
    0,
  );
console.log(`dist/  ${(bytes(out) / 1024 / 1024).toFixed(1)} MB, ready to publish`);
