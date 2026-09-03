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
// Three sites come out of this, not one. `v1/` and `v2/` are the pages for the
// retired vaults, each with its own sources and its own bundle, built exactly
// the same way into `dist/v1/` and `dist/v2/`. Their own bundles rather than a
// shared one: all three are pointed at different contracts, and a chunk any two
// of them loaded would be a place for that difference to leak.
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

// The same switch for Emily, which is a second function answering a second
// host: `netlify/functions/emily.mjs`, which attaches the deposit API's token.
// Empty off a Netlify build, so a local build talks to Emily directly and needs
// no function running.
const EMILY_PROXY = JSON.stringify(
  process.env.EMILY_PROXY ?? (process.env.NETLIFY ? "/emily" : ""),
);

// The live site, and the retired vault's page under it. Each is its entries,
// the pages that name them, and the directory it is written to.
//
// The live site has two entries rather than one: `app.ts` is the pool's page,
// and `analytics.ts` is the keeper's list of what anyone may finish. They are
// built in one esbuild call so that what they share -- the template runtime,
// the config, and the wallet chunk both of them reach for -- is one chunk on
// disk and one download for a reader who opens both.
const SITES = [
  {
    entries: [join(root, "src", "app.ts"), join(root, "src", "analytics.ts")],
    dir: out,
    pages: ["index.html", "media-kit.html", "analytics.html"],
  },
  // One entry per retired vault. Each is a page about money a contract still
  // holds, so they are built separately rather than folded into the live
  // bundle: a reader who never had a position in one should not download it.
  { entries: [join(root, "v1", "src", "app.ts")], dir: join(out, "v1"), pages: ["v1/index.html"] },
  { entries: [join(root, "v2", "src", "app.ts")], dir: join(out, "v2"), pages: ["v2/index.html"] },
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
      ...site.entries,
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
      `--define:__EMILY_PROXY__=${EMILY_PROXY}`,
    ],
    { stdio: "inherit" },
  );
}

// 2. the static files, verbatim. One copy, at the top: the retired pages reach
// up for the stylesheet, the mark and the icons rather than duplicating them.
for (const file of FILES) cpSync(join(root, file), join(out, file));
for (const dir of DIRS) cpSync(join(root, dir), join(out, dir), { recursive: true });

// 3. the pages, each pointed at the bundles that were actually built beside it.
//
// A page names `app.js` or `analytics.js`; what esbuild wrote is that name plus
// a content hash. Every entry of the site is looked up once and every page is
// rewritten against all of them, so a page may name either -- or, one day, both.
for (const site of SITES) {
  const built = readdirSync(site.dir);
  const hashed = new Map();
  for (const path of site.entries) {
    const name = path.split("/").pop().replace(/\.ts$/, "");
    const file = built.find((f) => new RegExp(`^${name}-[A-Z0-9]+\\.js$`).test(f));
    if (!file) {
      console.error(`no hashed ${name} in ${site.dir} -- did esbuild change its naming?`);
      process.exit(1);
    }
    hashed.set(`${name}.js`, file);
  }
  for (const page of site.pages) {
    const html = readFileSync(join(root, page), "utf8");
    let rewritten = html;
    for (const [name, file] of hashed) {
      rewritten = rewritten.replaceAll(`src="${name}"`, `src="${file}"`);
    }
    if (rewritten === html && [...hashed.keys()].some((n) => html.includes(`src="${n}"`))) {
      console.error(`${page}: could not rewrite the script path`);
      process.exit(1);
    }
    const written = join(site.dir, page.split("/").pop());
    writeFileSync(written, rewritten);
    // A page still naming an unhashed entry would 404 for every visitor while
    // looking fine in the repo, so it is worth failing the build here.
    const stale = [...hashed.keys()].find((name) =>
      readFileSync(written, "utf8").includes(`src="${name}"`),
    );
    if (stale) {
      console.error(`${written} still points at an unhashed ${stale}`);
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
