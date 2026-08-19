// Renders index.html the way the browser will, and checks the wiring.
//
// Two things are worth catching here and nowhere else:
//
//   1. a `{{ name }}` the design uses that the logic never supplies -- it would
//      render as an empty string, silently, and look like a styling bug;
//   2. a directive the runtime does not resolve, leaving `sc-for` or a raw
//      mustache in the output.
//
//   pnpm test
import { readFileSync, existsSync as built, statSync, readdirSync } from "node:fs";
import { parseHTML } from "linkedom";

const fail: string[] = [];
const ok: string[] = [];
const check = (cond: unknown, label: string) => (cond ? ok : fail).push(label);

const html = readFileSync("index.html", "utf8");
const appSource = readFileSync("src/app.ts", "utf8");

/// --- 1. every binding the design uses is supplied ---------------------------

// Roots of every `{{ … }}` in the template, minus the loop variables the
// runtime introduces itself.
const loopVars = new Set(
  [...html.matchAll(/<sc-for[^>]*\sas="([^"]+)"/g)].map((m) => m[1]),
);
const roots = new Set(
  [...html.matchAll(/\{\{([^}]*)\}\}/g)]
    .map((m) => m[1].trim().split(".")[0])
    .filter((r) => r && r !== "true" && r !== "false" && !loopVars.has(r)),
);

// Keys the view model returns, plus the per-proposal fields `decorate` adds.
const supplied = new Set([
  ...[...appSource.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]),
  ...[...appSource.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*),$/gm)].map((m) => m[1]),
]);
const missing = [...roots].filter((r) => !supplied.has(r));
check(missing.length === 0, `every template binding is supplied${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);

/// --- 2. the runtime resolves the whole template ------------------------------

const { window, document } = parseHTML(html);
(globalThis as any).window = window;
(globalThis as any).document = document;

const { renderChildren } = await import("./src/render.js");

// A scope shaped like the view model, with the fields the template reads.
const proposal = (id: number) => ({
  id,
  kind: "propose-trust-signer",
  state: "Voting open",
  tone: { bg: "#eee", fg: "#111" },
  title: `Proposal ${id}`,
  blurb: "blurb",
  detail: "detail",
  yesLabel: "1,000",
  noLabel: "10",
  yesW: "90%",
  noW: "10%",
  approval: "90%",
  turnout: "40%",
  chips: [{ text: "Quorum met", bg: "#eee", fg: "#111" }],
  gateRows: [{ label: "Voting period", value: "1d", icon: "✓", dot: "#0a0", fg: "#060" }],
  voted: "",
  showVoted: false,
  canVote: true,
  needsWallet: false,
  open: () => {},
  voteYes: () => {},
  voteNo: () => {},
});

const proposals = [proposal(4), proposal(3)];
const scope: Record<string, unknown> = {
  statSats: "0", statMembers: "0", statEpoch: "—", statHoney: "0",
  connected: true, disconnected: false, walletOpen: true,
  walletLabel: "SP2J8XK…9K4T",
  memberSatsLabel: "10,000,000", memberWeight: "3,162", memberShare: "13.1%",
  openWallet: () => {}, closeWallet: () => {}, connect: () => {},
  disconnect: () => {}, closeDetail: () => {},
  proposals, sel: proposals[0], hasSelection: true, noSelection: false,
  weightDemo: [{ label: "1 BTC", weight: "10,000", stakeW: "100%", sayW: "92%" }],
  powers: [{ call: "trust-signer-manager", title: "Add a manager", body: "body" }],
  gates: [{ n: "1", label: "Voting period", body: "body" }],
  trust: [{ title: "It cannot reach a deposit", body: "body" }],
  faq: [{ q: "Question?", a: "Answer." }],
  join: {
    open: true, closed: false, connected: true,
    closedWhy: "closed because", depositTo: "ST1.bond-treasury",
    quote: "10,000,000 sats needs 5.00 STX", balance: "1.0000 BTC",
    queuedSats: "0.1000 BTC", queuedUstx: "5.00 STX", committed: "0.0000 BTC",
    releasedSats: "0.0000 BTC", rewards: "0.0000 BTC",
    hasQueued: true, hasReleased: true, hasRewards: true,
    deposit: () => {}, withdraw: () => {}, commit: () => {}, reveal: () => {},
    confirm: () => {}, claimPrincipal: () => {}, claimRewards: () => {},
  },
  bond: {
    show: true,
    kicker: "Next bond",
    headline: "Bond 3",
    lead: "lead",
    rows: [{ label: "Term ends", value: "burn 9000", when: "in 4d 2h", icon: "✓", fg: "#060" }],
  },
  networks: [
    { name: "testnet", label: "testnet", note: "", bg: "#c67139", fg: "#fff", choose: () => {} },
    { name: "mainnet", label: "mainnet", note: "not deployed", bg: "transparent", fg: "#201e1d", choose: () => {} },
  ],
};

const template = document.getElementById("tpl") as unknown as HTMLTemplateElement | null;
const mount = document.getElementById("app");
check(Boolean(template) && Boolean(mount), "index.html has #tpl and #app");

for (const node of renderChildren(template!.content, scope, document as unknown as Document)) {
  mount!.appendChild(node);
}
const out = mount!.innerHTML;

check(out.length > 20_000, `rendered ${out.length} bytes of markup`);
check(!out.includes("{{"), "no unresolved mustaches remain");
check(!/<sc-(for|if)/.test(out), "no unresolved sc-for / sc-if remain");
check(!out.includes("hint-placeholder"), "canvas-only hint attributes are dropped");
check(!out.includes("__claude_design_branding"), "canvas branding is not present");

/// --- 3. the design's content actually survived --------------------------------

const text = mount!.textContent!.replace(/\s+/g, " ");
for (const phrase of [
  "A hive that holds the bond",
  "The name is not decoration",
  "How the pool works",
  "Weight is the square root of your sats",
  "Five powers, one mandate each",
  "Six gates",
  "The vote floor",
  "What the operator cannot do",
]) {
  check(text.includes(phrase), `keeps "${phrase}"`);
}

check(mount!.querySelectorAll("svg").length > 0, "svg icons render in their namespace");

// The join controls the member actually presses.
for (const id of ["join-sats", "join-quote", "btc-txid", "btc-vout"]) {
  check(Boolean(mount!.querySelector(`#${id}`)), `the join form has #${id}`);
}
check(
  mount!.querySelectorAll("button").length >= 8,
  "deposit, withdraw, the three bridge steps and the claims are all buttons",
);
// Without this the marks keep their user-space size and get clipped -- a broken
// logo that looks like a styling problem rather than a missing attribute.
check(!out.includes("sc-camel-"), "no sc-camel-* attributes survive into the output");
// Counted in the markup rather than with `svg[viewBox]`: the DOM the test
// renders through matches attribute selectors case-insensitively, so the
// selector cannot tell `viewBox` from a lower-cased `viewbox` the SVG parser
// would have ignored.
const viewBoxes = (out.match(/viewBox=/g) ?? []).length;
check(viewBoxes >= 3, `viewBox survives the camelCase rewrite (${viewBoxes} found)`);
check(!/viewbox=/.test(out), "and keeps its capital B, which SVG requires");
check(
  out.includes("patternUnits"),
  "patternUnits survives too, so the honeycomb backgrounds tile",
);
check(
  mount!.querySelectorAll("[sc-camel-on-click]").length === 0,
  "click directives are consumed, not left as attributes",
);
check(
  mount!.querySelectorAll("[style-hover]").length === 0,
  "style-hover is converted, not left as an inert attribute",
);
const hoverSheet = document.getElementById("hover-styles");
check(
  Boolean(hoverSheet) && hoverSheet!.textContent!.includes(":hover{"),
  "hover states become real CSS rules",
);

/// --- 3b. every local link resolves ------------------------------------------

const { existsSync } = await import("node:fs");
const deadLinks = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((h) => !/^(https?:|#|data:|mailto:)/.test(h))
  .map((h) => h.split("#")[0])
  .filter((h) => h && !existsSync(h));
check(deadLinks.length === 0, `no dead local links${deadLinks.length ? ` (${[...new Set(deadLinks)].join(", ")})` : ""}`);

/// --- 3c. the naming rule ------------------------------------------------------

// The name is a word, not initials. Nothing on the site spells the S+B
// derivation out -- not in the copy, not as a lockup, not in the mark's
// description.
const pages = ["index.html", "media-kit.html"].map((f) => readFileSync(f, "utf8"));
for (const banned of ["S · B", "S-B", "S + B", "gives S and B", "an S and a B", "into initials"]) {
  check(
    pages.every((page) => !page.includes(banned)),
    `no "${banned}" anywhere on the site`,
  );
}

/// --- 3d. one mark, and it matches the header ------------------------------------

// `esbee.svg` is the file the favicon and the media kit point at; the header
// draws the same artwork inline. If someone edits one, this catches the drift.
const markFile = readFileSync("esbee.svg", "utf8");
const CELL = 'd="M32 3 L59 18 L59 46 L32 61 L5 46 L5 18 Z"';
check(markFile.includes(CELL), "esbee.svg draws the header's cell");

// The mark is parsed as XML, not HTML: a stray `--` inside a comment is a parse
// error and the favicon silently does not render at all. Cheap to assert, and
// invisible without a browser.
const commentBodies = [...markFile.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]!);
check(
  commentBodies.every((body) => !body.includes("--")),
  "no double hyphen inside the mark's XML comments",
);
check(
  (markFile.match(/<!--/g) ?? []).length === (markFile.match(/-->/g) ?? []).length,
  "the mark's comments are balanced",
);
check(pages[0]!.includes(CELL), "the header draws it inline too");
// Comments stripped first: the file explains *why* it avoids custom properties,
// and the explanation names them.
const markCode = markFile.replace(/<!--[\s\S]*?-->/g, "");
check(
  !markCode.includes("var(--color-"),
  "the standalone mark uses literal colours, since a favicon has no page to read from",
);
check(
  pages.every((page) => !page.includes("favicon.svg")),
  "there is one mark file, not a separate favicon",
);
for (const icon of ["icons/icon-32.png", "icons/icon-180.png"]) {
  check(built(icon), `${icon} exists for the browsers that will not take an SVG`);
}

/// --- 4. the chain layer is wired to the real contract -------------------------

const chainSource = readFileSync("src/chain.ts", "utf8");
for (const fn of [
  "propose-trust-signer", "propose-distrust-signer", "propose-signer-change",
  "propose-operator-change", "propose-sweep", "vote",
  "execute-trust-signer", "execute-distrust-signer", "execute-operator-change",
  "execute-sweep", "execute-signer-change",
  "get-proposal", "get-status", "get-vote", "get-weight", "get-quorum",
  "get-proposal-count", "current-epoch",
]) {
  check(chainSource.includes(`"${fn}"`), `chain.ts calls ${fn}`);
}
check(chainSource.includes("@stacks/connect"), "chain.ts uses @stacks/connect for the wallet");
check(chainSource.includes("@stacks/transactions"), "chain.ts uses @stacks/transactions for Clarity values");

/// --- 5. the wallet SDK stays out of the initial load -------------------------

// The whole point of splitting `chain.ts` out: stacks.js and the wallet SDK are
// ~1.4 MB, and a reader who never connects should not download them. If someone
// makes the chain import static again this is the check that notices.
if (built("dist/app.js")) {
  const eager = new Set<string>();
  const walk = (file: string): number => {
    if (eager.has(file) || !built(`dist/${file}`)) return 0;
    eager.add(file);
    const text = readFileSync(`dist/${file}`, "utf8");
    let bytes = statSync(`dist/${file}`).size;
    for (const m of text.matchAll(/(?:from|import)"\.\/([^"]+)"/g)) bytes += walk(m[1]);
    return bytes;
  };
  const eagerBytes = walk("app.js");
  const totalBytes = readdirSync("dist")
    .filter((f) => f.endsWith(".js"))
    .reduce((n, f) => n + statSync(`dist/${f}`).size, 0);

  check(
    eagerBytes < 60_000,
    `initial load is ${(eagerBytes / 1024).toFixed(1)} kB of ${(totalBytes / 1024).toFixed(0)} kB built`,
  );
  check(
    !eager.has("app.js") || !readFileSync("dist/app.js", "utf8").includes("@stacks"),
    "the wallet SDK is not in the entry chunk",
  );
} else {
  ok.push("skipped bundle checks (run `pnpm run build` first)");
}

/// --- report ---------------------------------------------------------------------

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of fail) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
