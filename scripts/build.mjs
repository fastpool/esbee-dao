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
//
// Two sites come out of this, not one. `v1/` is the page for the retired vault,
// with its own sources and its own bundle, and it is built exactly the same way
// into `dist/v1/`. Its own bundle rather than a shared one: the two are pointed
// at different contracts, and a chunk they both loaded would be a place for
// that difference to leak.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");

// `NETLIFY` is set by Netlify's own build, and `netlify/functions/hiro.mjs` is
// only there. Keyed off the environment rather than a flag so that neither a
// deploy nor a local build has to remember to pass anything.
const API_PROXY = JSON.stringify(
  process.env.API_PROXY ?? (process.env.NETLIFY ? "/api" : ""),
);

// The live site, and the retired vault's page under it. Each is an entry, the
// pages that name it, and the directory it is written to.
const SITES = [
  { entry: join(root, "src", "app.ts"), dir: out, pages: ["index.html", "media-kit.html"] },
  { entry: join(root, "v1", "src", "app.ts"), dir: join(out, "v1"), pages: ["v1/index.html"] },
];
const FILES = ["styles.css", "esbee.svg"];
const DIRS = ["fonts", "icons"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. the bundles. Split, so the wallet SDK stays out of the initial load.
for (const site of SITES) {
  execFileSync(
    join(root, "node_modules", "esbuild", "bin", "esbuild"),
    [
      site.entry,
      "--bundle",
      "--splitting",
      "--format=esm",
      "--target=es2022",
      `--outdir=${site.dir}`,
      "--sourcemap",
      "--minify",
      // Hash the entry too. Without this `app.js` is the one file a host cannot
      // cache immutably, and getting that rule wrong pins a stale bundle on
      // every returning visitor.
      "--entry-names=[name]-[hash]",
      // Where reads go. On Netlify that is this site's own function, which holds
      // the Hiro key; everywhere else the empty string leaves `config.ts` talking
      // to Hiro directly, anonymously. `API_PROXY=` in the environment overrides
      // both, for a build that is deployed somewhere else again.
      `--define:__API_PROXY__=${API_PROXY}`,
    ],
    { stdio: "inherit" },
  );
}

// 2. the static files, verbatim. One copy, at the top: `v1/index.html` reaches
// up for the stylesheet, the mark and the icons rather than duplicating them.
for (const file of FILES) cpSync(join(root, file), join(out, file));
for (const dir of DIRS) cpSync(join(root, dir), join(out, dir), { recursive: true });

// 3. the pages, each pointed at the bundle that was actually built beside it.
for (const site of SITES) {
  const entry = readdirSync(site.dir).find((f) => /^app-[A-Z0-9]+\.js$/.test(f));
  if (!entry) {
    console.error(`no hashed entry in ${site.dir} -- did esbuild change its naming?`);
    process.exit(1);
  }
  for (const page of site.pages) {
    const html = readFileSync(join(root, page), "utf8");
    const rewritten = html.replaceAll('src="app.js"', `src="${entry}"`);
    if (html.includes('src="app.js"') && rewritten === html) {
      console.error(`${page}: could not rewrite the script path`);
      process.exit(1);
    }
    const written = join(site.dir, page.split("/").pop());
    writeFileSync(written, rewritten);
    // A page still naming the unhashed entry would 404 for every visitor while
    // looking fine in the repo, so it is worth failing the build here.
    if (readFileSync(written, "utf8").includes('src="app.js"')) {
      console.error(`${written} still points at an unhashed app.js`);
      process.exit(1);
    }
  }
}

const bytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) =>
      n + (e.isDirectory() ? bytes(join(dir, e.name)) : statSync(join(dir, e.name)).size),
    0,
  );
console.log(`dist/  ${(bytes(out) / 1024 / 1024).toFixed(1)} MB, ready to publish`);
