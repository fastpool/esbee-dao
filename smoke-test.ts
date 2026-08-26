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
const chatSource = readFileSync("src/chat.ts", "utf8");

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

// Keys the view models return, plus the per-proposal fields `decorate` adds.
// Two templates, two view models: the page's in app.ts and the chat's in
// chat.ts. Their roots are checked together, since a name only has to be
// supplied by the one that renders it.
const keysOf = (source: string) => [
  ...[...source.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]),
  ...[...source.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*),$/gm)].map((m) => m[1]),
];
const supplied = new Set([...keysOf(appSource), ...keysOf(chatSource)]);
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
  dummy: true,
  open: () => {},
  voteYes: () => {},
  voteNo: () => {},
});

const proposals = [proposal(4), proposal(3)];
const scope: Record<string, unknown> = {
  statSats: "0", statEpoch: "—", statHoney: "0",
  statEpochNote: "bond 3 bound, not yet staked",
  connected: true, disconnected: false, walletOpen: true,
  walletLabel: "SP2J8XK…9K4T",
  profileAddress: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
  switchAccount: () => {},
  beeShow: true, beeName: "amber-drone", beeColor: "#c67139",
  beeNpub: "npub1amber…9f8e7d", beeNpubFull: "npub1amber",
  beeLinked: "linked to this address, and verified as a member",
  memberSatsLabel: "10,000,000", memberWeight: "3,162", memberShare: "13.1%",
  openWallet: () => {}, closeWallet: () => {}, connect: () => {},
  disconnect: () => {}, closeDetail: () => {},
  proposals, sel: proposals[0], hasSelection: true, noSelection: false,
  dummy: true, noProposals: true,
  noProposalsWhy: "Nothing has been raised on this deployment yet.",
  sources: [{ label: "Dummy", note: "fixtures", bg: "var(--color-accent)", fg: "var(--color-bg)", choose: () => {} }],
  weightDemo: [{ label: "1 BTC", weight: "10,000", stakeW: "100%", sayW: "92%" }],
  powers: [{ call: "trust-signer-manager", title: "Add a manager", body: "body" }],
  gates: [{ n: "1", label: "Voting period", body: "body" }],
  trust: [{ title: "It cannot reach a deposit", body: "body" }],
  faq: [{ q: "Question?", a: "Answer." }],
  join: {
    open: true, closed: false, connected: true, disconnected: true,
    connect: () => {},
    closedWhy: "closed because", depositTo: "ST1.bond-treasury",
    quote: "10,000,000 sats needs 5.00 STX", balance: "1.0000 BTC",
    amount: "10000000", amountLabel: "Amount in sats", placeholder: "10000000",
    satsFg: "var(--color-text)", satsLine: "underline",
    sbtcFg: "var(--color-neutral-700)", sbtcLine: "none",
    showSats: () => {}, showSbtc: () => {}, useMax: () => {}, maxHint: "use all",
    useBtcMax: () => {}, btcMaxHint: "use all",
    underway: true, underwayNote: "This deposit is already committed to on chain",
    pickCursor: "default",
    pendingShow: true, pendingText: "In the mempool.",
    pendingTxid: "0x1234…abcd", pendingLink: "https://explorer.hiro.so/txid/0x1234",
    queuedSats: "0.1000 BTC", queuedUstx: "5.00 STX", committed: "0.0000 BTC",
    releasedSats: "0.0000 BTC", rewards: "0.0000 BTC",
    hasQueued: true, hasReleased: true, hasRewards: true,
    deposit: () => {}, withdraw: () => {}, commit: () => {}, reveal: () => {},
    confirm: () => {}, claimPrincipal: () => {}, claimRewards: () => {},
    wrongNetwork: true, networkWarning: "Your wallet is a mainnet address",
    faucets: true, faucetStx: () => {}, faucetSbtc: () => {},
  },
  l1: {
    recipient: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.bond-treasury-2",
    amount: "10000000", amountLabel: "Amount in sats", placeholder: "10000000",
    quote: "10,000,000 sats needs 5.00 STX",
    address: "tb1qn69zsypuk4frdlmnwhzfa7ugvqvak3n32hg33z",
    addressPlaceholder: "tb1q…",
    addressNote: "Send from this address and no other", addressLocked: false,
    commit: () => {}, reveal: () => {}, deposit: () => {},
    register: () => {}, complete: () => {}, cancel: () => {},
    cancelWhen: "yours to abandon at any time",
    emilyShow: true, emilyStatus: "The signers: pending", emilyTone: "#c67139",
    emilyNote: "Received, and not swept yet.", checkStatus: () => {},
    proofShow: true,
    proofDeposit: "2e0000000000013880061a1ec83ce8…", proofReclaim: "02b603b27520870649…",
    copyDeposit: () => {}, copyReclaim: () => {},
    proofReclaimNote: "If the signers never sweep it, the second path opens after 6 days 14 hours",
    proofParams: [
      { name: "Recipient (credited)", value: "ST1.bond-treasury-2" },
      { name: "Signers' public key", value: "ce58199f1d81fe4e…" },
      { name: "Reclaim public key (yours)", value: "870649cc3bfd3820…" },
      { name: "Max signer fee", value: "80,000 sats" },
      { name: "Reclaim lock time", value: "950 blocks" },
    ],
    doneShow: false, startAgain: () => {},
    historyShow: true, historyEmpty: false, historyLabel: "Show my past deposits",
    historyNote: "the contract's last 50 events", loadHistory: () => {},
    history: [
      {
        what: "Credited to the pool",
        amount: "0.5 BTC",
        txid: "31c8e7…f9cbb",
        txidShow: true,
        txidLink: "https://mempool.bitcoin.regtest.hiro.so/tx/31c8e7",
        stacksLink: "https://explorer.hiro.so/txid/0x1?chain=testnet",
      },
    ],
    txid: "", vout: "0",
    txidShow: true, txidShort: "32d950…a2bb",
    txidLink: "https://mempool.bitcoin.regtest.hiro.so/tx/32d950c8",
    faucetTxShow: true, faucetTxShort: "a1b2c3…9f8e",
    faucetTxLink: "https://mempool.bitcoin.regtest.hiro.so/tx/a1b2c3d4",
    stageShow: true, stageStep: "Step 2 of 5", stageTitle: "Reveal the address",
    stageNote: "The wait is over.", stageBarW: "20%",
    stageAmountShow: true, stageAmount: "10,000,000 sats committed · 5.00 STX paid",
    s1: { mark: "✓", bg: "#0a0", fg: "#fff", dim: "0.55", state: "done", tone: "#0a0", now: false, live: false, open: () => {}, cursor: "pointer" },
    s2: { mark: "2", bg: "#c67139", fg: "#fff", dim: "1", state: "you are here", tone: "#c67139", now: false, live: false, open: () => {}, cursor: "pointer" },
    s3: { mark: "3", bg: "#eee", fg: "#333", dim: "0.5", state: "", tone: "#333", now: true, live: true, open: () => {}, cursor: "pointer" },
    s4: { mark: "4", bg: "#eee", fg: "#333", dim: "0.5", state: "", tone: "#333", now: false, live: false, open: () => {}, cursor: "pointer" },
    s5: { mark: "5", bg: "#eee", fg: "#333", dim: "0.5", state: "", tone: "#333", now: false, live: false, open: () => {}, cursor: "pointer" },
    commitBtn: "btn-secondary", commitDim: "0.55", commitHint: "Done.",
    revealBtn: "btn-primary", revealDim: "1", revealHint: "This is the one to press.",
    depositBtn: "btn-secondary", depositDim: "0.55", depositHint: "Step 2 comes first.",
    completeBtn: "btn-secondary", completeDim: "0.55", completeHint: "Step 2 comes first.",
    digestShow: true, digestShort: "0x9f3ca12b…4d5e6f70", digestFull: "0x9f3ca12b",
    copyDigest: () => {},
    revealedShow: true, revealedShort: "tb1qn69zsypuk…2hg33z",
    revealedFull: "tb1qn69zsypuk4frdlmnwhzfa7ugvqvak3n32hg33z",
    revealedHeld: "held until burn height 100,000", copyRevealed: () => {},
    saltShow: true, saltState: "kept in this browser",
    saltTone: "var(--color-accent-2-800)",
    saltNote: "It is here and nowhere else.",
    targetShow: true, targetHidden: true, showAddress: () => {},
    targetAddress: "tb1pe7zjdf0kshuym99yprwdda3gnw753qrzlphheytmr6fg7ha2wy5q7lfplm",
    targetShort: "tb1pe7zjdf0ksh…7lfplm", copyTarget: () => {},
    targetAmount: " · 0.10000000 BTC",
    faucet: true, faucetBtc: () => {},
    offline: true,
    offlineWhy: "This page has no sBTC deposit service configured for testnet",
  },
  early: {
    show: true, ready: true,
    committed: "0.0500 BTC", committedSats: "5,000,000",
    ustxAtRoll: "12.00 STX", banked: "0.0013 BTC", atRisk: "0.0004 BTC",
    hasAtRisk: true, sync: () => {},
    amount: "5000000", placeholder: "5000000", useAll: () => {},
    unstake: () => {},
    blocked: true,
    blockedWhy: "You have already requested an exit",
    cancelExit: () => {},
  },
  stage: {
    label: "Deposits open · bond 3 starts in 10d 7h",
    bg: "var(--color-accent-2-200)",
    fg: "var(--color-accent-2-800)",
    dot: "var(--color-accent-2-600)",
  },
  launch: {
    title: "Filling the allocation",
    lead: "it runs inside the window before the bond starts",
    pct: "0.50%",
    barW: "1.5%",
    gathered: "500,000 sats gathered · 0.0050 BTC",
    target: "allocation: 1.0000 BTC",
    note: "The STX leg is 0.25 STX short of carrying all of it.",
    hasNote: true,
    ctaShow: true,
    ctaLabel: "Add to the pool",
    milestoneShow: true,
    milestoneReached: false,
    milestoneLabel: "50% · 0.5000 BTC launches it",
    stakeShow: true,
    stakeReady: false,
    stakeLabel: "Stake the pool — open epoch 0",
    stakeWait: "The stake window opens at burn 8,712, in 7d 23h.",
    stake: () => {},
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
  poolShow: true,
  poolName: "vault-2",
  poolContract: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.vault-2",
  poolLink: "https://explorer.hiro.so/txid/STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.vault-2?chain=testnet",
  retiredShow: true,
  retiredName: "vault-1",
  retiredContract: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.vault-1",
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

// The header button opens who you are, not a list of wallets this page cannot
// actually detect. The chat's identity belongs there too: it is a nostr key
// made in this browser, and the name other members see.
for (const phrase of ["Your account", "voting power", "Switch account", "Your bee, in the discussion"]) {
  check(text.includes(phrase), `the profile shows "${phrase}"`);
}
check(
  !text.includes("Connect a wallet") && !text.includes("Xverse") && !text.includes("Asigna"),
  "and the page no longer keeps a wallet list of its own",
);

// The two assets are the real marks, not a letter in a circle: sBTC's own
// logo as a file, and bitcoin's as the mark bitcoin.org put in the public
// domain, drawn inline so it costs no request and stays sharp at any size.
check(
  out.includes('src="icons/sbtc.png"') && built("icons/sbtc.png"),
  "the sBTC balance carries the sBTC logo",
);
check(out.includes("#F7931A"), "and the bitcoin balance carries bitcoin's own");

// The card talks about the reclaim lock before `l1.ts` is loaded, so it keeps
// its own copy of the number. Two copies of a constant is one too many unless
// something fails when they disagree.
check(
  /const RECLAIM_LOCK_TIME = (\d+);/.exec(readFileSync("src/app.ts", "utf8"))?.[1] ===
    /export const RECLAIM_LOCK_TIME = (\d+);/.exec(readFileSync("src/l1.ts", "utf8"))?.[1],
  "the reclaim lock the card names is the one the address is built with",
);
check(
  /const MAX_SIGNER_FEE = ([\d_]+);/.exec(readFileSync("src/app.ts", "utf8"))?.[1] ===
    /export const MAX_SIGNER_FEE = ([\d_]+);/.exec(readFileSync("src/l1.ts", "utf8"))?.[1],
  "and so is the max signer fee",
);

// Two vaults exist under one DAO, so a page that does not name the one it is
// reading is ambiguous about whose balances it is showing.
check(
  text.includes("Esbee DAO contract") && text.includes("vault-2"),
  "the live page names the Esbee DAO contract it talks to",
);
check(
  out.includes('href="v1/index.html"'),
  "and points a member with a position in the retired one at its page",
);

// The deposit card asks its shared questions once -- one amount, one STX leg,
// one address -- and only then asks which way the member is paying. So the
// route-specific halves are behind a choice, and the phrases below are checked
// against a render that has made it.
const routed = document.createElement("div");
for (const node of renderChildren(
  template!.content,
  { ...scope, join: { ...(scope.join as object), l1Route: true, unchosen: false } },
  document as unknown as Document,
)) {
  routed.appendChild(node);
}
const routedText = routed.textContent!.replace(/\s+/g, " ");

// The join controls the member actually presses. `btc-sats` is deliberately
// absent: there is one amount field now, because the STX leg is the same
// number whichever way the sats arrive.
for (const id of ["join-sats", "join-quote", "btc-address"]) {
  check(Boolean(mount!.querySelector(`#${id}`)), `the join form has #${id}`);
}
check(!mount!.querySelector("#btc-sats"), "and asks the amount once, not once per route");
for (const id of ["btc-txid", "btc-vout"]) {
  check(Boolean(routed.querySelector(`#${id}`)), `the L1 route has #${id}`);
}
// Mid-route the switch and the balances stop being controls: the amount is
// mixed into a hash on chain, and changing half of what was committed to is
// not a smaller version of what the member meant.
check(
  routedText.includes("settled with the commitment"),
  "a committed route says so where the choice used to be",
);
check(
  routedText.includes("Paying with") &&
    routedText.includes("sBTC") &&
    routedText.includes("BTC (L1)"),
  "the member chooses the route, having seen what each would cost",
);
// Bridge v2 commits to the address the bitcoin comes from, not to the
// transaction -- so the card asks for an address and an amount up front, and
// its third step is a deposit this page can actually make.
check(text.includes("Your bitcoin address"), 'the card asks "Your bitcoin address" before the choice');
// A cancelled or replaced route must not leave its deposit attached to the
// next one, or the card waits on a transaction that has nothing to do with the
// commitment now standing.
{
  const source = readFileSync("src/app.ts", "utf8");
  const cancel = source.slice(source.indexOf("async function doCancelL1"));
  check(
    (cancel.slice(0, cancel.indexOf("function endRoute")).match(/endRoute\(/g) ?? [])
      .length === 2,
    "cancelling puts the route down rather than only re-reading it",
  );
  const commit = source.slice(source.indexOf("async function doCommit"));
  check(
    commit.slice(0, commit.indexOf("async function", 10)).includes("forgetSent("),
    "and a new commitment inherits nothing from the last one",
  );
}

// Both legs of a committed route come off the bridge, not off a fresh quote:
// the pool may have rolled since the commit, and what the member paid is what
// the announcement says they paid. Re-quoting would price it against a bond
// they are not in.
{
  const source = readFileSync("src/app.ts", "utf8");
  check(
    source.includes("const lockedUstx = ()") &&
      /quote:\s*\n\s*lockedSats\(\) !== null/.test(source),
    "a committed route states its STX leg rather than asking for an amount",
  );
}

// The deposit a member already told the page about has to be in hand *before*
// the reads that decide which step they are on, not restored alongside them.
// Restored alongside, the reads see an empty txid on the first load after a
// reload, a deposit waiting to be swept comes back as step 3, and the member is
// asked to register a transaction the page already knew about.
{
  const source = readFileSync("src/app.ts", "utf8");
  const body = source.slice(source.indexOf("async function loadL1"));
  const remembered = body.indexOf("rememberedSent(text)");
  const reads = body.indexOf("await Promise.all(");
  check(
    remembered > 0 && reads > remembered,
    "the remembered deposit is read before the reads that place the member",
  );
}

// The header is sticky, and stays that way only while nothing above it makes a
// scroll container: `overflow-x: hidden` on an ancestor is enough to make a
// sticky descendant stick to that ancestor instead of the viewport, which
// looks exactly like the sticky never being there.
check(
  /min-height:100vh;overflow-x:clip/.test(readFileSync("index.html", "utf8")),
  "nothing above the sticky header turns itself into a scroll container",
);

// A step's header carries the press that folds it; its body must not be inside
// that header, or every Copy button and every disclosure inside an open step
// bubbles up and closes the step the member was reading.
const markup = readFileSync("index.html", "utf8");
for (const n of [1, 2, 3, 4, 5]) {
  const from = markup.indexOf(`l1.s${n}.open`);
  const to = markup.indexOf(`l1.s${n}.now`);
  check(
    from > 0 && to > from && markup.slice(from, to).includes("</div>"),
    `step ${n}'s body sits outside the header that folds it`,
  );
}

// The five steps are always listed, so the route reads as a route whatever
// state the member is in.
for (const phrase of ["Commit", "Reveal", "Deposit", "Wait", "Complete"]) {
  check(routedText.includes(phrase), `the L1 route lists "${phrase}"`);
}
// ...but only the live step is unfolded, and what it holds is its own. The
// fixture puts the member on step 3, so these belong to it and nothing from
// the other four should be beside them.
for (const phrase of [
  "Send from ·",
  "Send it from my wallet",
  "Register it with the signers",
  // A member deciding whether to send real money to a generated string is
  // owed the address's own two spending paths, and the rules for paying it
  // from a wallet this page cannot drive.
  "What is this address, and is it safe to pay?",
  "Paying from another bitcoin wallet",
  "Every input must come from the address you revealed",
  // ...and the five values an independent tool needs to arrive at the same
  // address. Without them "is it safe" can only be answered by this page.
  "Max signer fee",
  "Reclaim lock time",
  "sbtc.stacks.co",
]) {
  check(routedText.includes(phrase), `step 3 carries "${phrase}"`);
}
check(
  !routedText.includes("Credit it to the pool") && !routedText.includes("Commit this address"),
  "and the steps the member is not on keep their buttons folded away",
);
// The history is a card of its own beside the position, not a tail on the
// route: what it holds is finished, and a member reading it is not working the
// deposit that is still open.
check(
  text.includes("Your deposits") &&
    text.includes("Credited to the pool") &&
    text.includes("0.5 BTC"),
  "a member can see what they have done here before, with both transactions linked",
);
check(
  !routedText.slice(0, routedText.indexOf("Your deposits")).includes("Show my past deposits"),
  "and it is not inside the route that made them",
);
// Step 4's own body, which needs the member to be standing on step 4.
const waiting = document.createElement("div");
for (const node of renderChildren(
  template!.content,
  {
    ...scope,
    join: { ...(scope.join as object), l1Route: true, unchosen: false },
    l1: {
      ...(scope.l1 as object),
      s3: { ...((scope.l1 as Record<string, any>).s3 as object), now: false, live: false },
      s4: { ...((scope.l1 as Record<string, any>).s4 as object), now: true, live: true },
    },
  },
  document as unknown as Document,
)) {
  waiting.appendChild(node);
}
const waitingText = waiting.textContent!.replace(/\s+/g, " ");
check(
  waitingText.includes("The signers: pending") && waitingText.includes("Check again"),
  "step 4 says what the signers are doing with the deposit it is waiting on",
);
check(
  !routedText.includes("The signers: pending"),
  "and says it there rather than under a step the member is not on",
);
check(
  routedText.includes("Give up and take the STX back"),
  "the way out is offered apart from the steps, not as one of them",
);
check(!text.includes("3 · Broadcast"), "and no longer calls the third step a broadcast");
// Three legs, three faucets: a reader on testnet who holds none of them can
// still work either route through to the end.
check(text.includes("Get BTC"), "the L1 card offers the bitcoin faucet");
// The faucet pays a bitcoin address, and Hiro's pays testnet ones. A page about
// testnet that prompts for `bc1q…` is asking for a request that cannot succeed.
const configSource = readFileSync("src/config.ts", "utf8");
check(
  /testnet: "tb1q…"/.test(configSource) && /mainnet: "bc1q…"/.test(configSource),
  "the address field is prompted for the chain the page is on",
);
check(
  configSource.includes("onConfiguredChain"),
  "and an address for another chain is refused before the faucet is asked",
);
// The burnchain under Stacks testnet is a regtest one, so its addresses are
// `bcrt1…` and only an explorer that can see into it can read a deposit back.
// A public explorer here is the failure that looks like a working page.
check(
  /chain: "regtest"/.test(configSource) &&
    !/api: "https:\/\/mempool\.space\/testnet4/.test(configSource),
  "testnet's bitcoin is regtest, with an API that can see that chain",
);
// A bitcoin txid on the Stacks explorer is a dead link that looks live, so the
// two bases are separate fields and separate helpers.
check(
  configSource.includes("explorerBtcTx") && /explorer: "https:\/\/mempool\./.test(configSource),
  "and a bitcoin txid links to a bitcoin explorer of its own",
);
check(
  out.includes("mempool.bitcoin.regtest.hiro.so/tx/"),
  "the L1 card links the bitcoin it can see — the faucet's payment and the deposit",
);
const appSourceFaucets = readFileSync("src/app.ts", "utf8");
check(
  /faucets\/\$\{kind\}/.test(appSourceFaucets) &&
    appSourceFaucets.includes('"btc"') &&
    appSourceFaucets.includes('query.set("xlarge", "true")'),
  "and asks for the large drip, since the small one cannot fund a deposit",
);
// ── the route belongs to one account ────────────────────────────────────────
//
// Two ways the L1 card used to show a member somebody else's route, both of
// which ended with the amount and the address locked read-only against a
// commitment the reader had no part in -- and the lock is the one thing on that
// card a member cannot type their way out of.
//
// Asserted against the source rather than by rendering it: `l1Panel` reads
// module state and `app.ts` mounts itself on import, so the view model cannot
// be called from here. These are the exact lines that were missing.

// 1. Switching account has to put the previous one's route down. Nothing else
//    will: the fields are uncontrolled and hold whatever state says, and
//    `l1Chain` is only re-read for the address still sitting in the field.
check(
  /function forgetAccount\(\): Partial<State>/.test(appSourceFaucets),
  "app.ts has one place that puts a connected account's route down",
);
for (const cleared of ["l1Chain: null", 'btcAddress: ""', 'amount: ""', "deposit: null"]) {
  check(
    new RegExp(`forgetAccount[\\s\\S]{0,2000}${cleared.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(
      appSourceFaucets,
    ),
    `and it clears ${cleared}, which is what the locked fields are read from`,
  );
}
for (const path of ["doSwitchAccount", "doDisconnect", "doConnect"]) {
  const body = appSourceFaucets.slice(appSourceFaucets.indexOf(`function ${path}`));
  check(
    body.slice(0, 1200).includes("forgetAccount()"),
    `${path} puts the previous account's route down`,
  );
}

// 2. An announcement is keyed by the funding script and nothing else, so the
//    one standing against an address may belong to anyone -- another member, or
//    this member's other account. Its sats go to whoever revealed it, so the
//    card must not lock a member into it.
check(
  /announcement: \{ member: string;/.test(appSourceFaucets),
  "the announcement read back carries whose it is",
);
check(
  appSourceFaucets.includes("c.announcement.member === state.account"),
  "and the card only treats it as this account's when it is",
);
check(
  /const lockedSats[\s\S]{0,400}ourAnnouncement\(c\)\?\.sats/.test(appSourceFaucets),
  "so the amount is locked to this account's route, never to a stranger's",
);
check(
  appSourceFaucets.includes("That address is already spoken for"),
  "and an address somebody else revealed is said in words rather than locked",
);
// `cancel-btc-deposit` refuses a live announcement from anyone but the member
// who made it, so offering it there is a transaction that reverts. What the
// member wants is their own commitment's STX leg back.
check(
  /doCancelL1[\s\S]{0,900}String\(announced\["member"\] \?\? ""\) === state\.account/.test(
    appSourceFaucets,
  ),
  "and the way out cancels this account's own commitment rather than reverting",
);

// Leaving mid-term is `vault-2`'s one new power, and the card is mostly about
// what it costs -- so the costs are what is worth asserting, not the button.
for (const id of ["early-sats", "early-hint"]) {
  check(Boolean(mount!.querySelector(`#${id}`)), `the early exit has #${id}`);
}
for (const phrase of [
  "Leave before the term is up",
  "unstake-sbtc-early",
  "STX at the roll",
  "Honey at risk",
  "Sync rewards first",
  "released principal",
]) {
  check(text.includes(phrase), `the early exit says "${phrase}"`);
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

/// --- 3a. the discussion panel renders too -----------------------------------------

// The chat has its own template and mount, outside #app, so a message arriving
// cannot re-render the page and a page re-render cannot wipe the log. The
// same runtime resolves it, and the same things can go wrong.
const chatTemplate = document.getElementById("chat-tpl") as unknown as HTMLTemplateElement | null;
const chatMount = document.getElementById("chat");
check(Boolean(chatTemplate) && Boolean(chatMount), "index.html has #chat-tpl and #chat");

const chatScope = (open: boolean): Record<string, unknown> => ({
  chatOpen: open, chatClosed: !open, toggleChat: () => {},
  unread: "3", hasUnread: true, fabLabel: "Discuss",
  statusLine: "Live · 3 of 4 relays", roomLink: "https://njump.me/nevent1room", hasRoomLink: true,
  myName: "bee-a1b2", myColor: "hsl(20 48% 42%)",
  myKey: "npub1a1b2c3d…xyz", openIdentity: () => {}, closeSheet: () => {},
  tabs: { showPublic: () => {}, showMembers: () => {}, publicBg: "#c67139", publicFg: "#fff",
    membersBg: "transparent", membersFg: "#201e1d", membersNote: "2 verified" },
  hasTopic: true, topicId: 4, topicTitle: "Trust signer manager 0x9f3c…a12b",
  clearTopic: () => {}, openTopic: () => {},
  showGate: true, gateTitle: "Members only", gateText: "Link your wallet.", gateAction: "Verify",
  hasGateAction: true, gateRun: () => {}, showFailed: true, failedText: "offline",
  showEmpty: true, emptyText: "Nobody has said anything yet.",
  messages: [
    { id: "a", name: "bee-a1b2", color: "#333", time: "14:02", showHead: true, mine: false,
      bg: "#eee", member: true, link: "https://njump.me/nevent1abc", hasLink: true,
      online: true, openProfile: () => {}, canReact: true, react: () => {},
      reactions: [{ emoji: "🐝", count: 2, who: "a, b", bg: "#eee", border: "#c67139", toggle: () => {} }],
      hasReactions: true,
      parts: [{ text: "see ", href: "", plain: true }, { text: "https://x.y", href: "https://x.y", plain: false }],
      hasProposal: true, proposal: 4, proposalTitle: "Trust signer", openProposal: () => {} },
    { id: "b", name: "bee-c3d4", color: "#444", time: "14:03", showHead: false, mine: true,
      bg: "#eee", member: false, link: "", hasLink: false, parts: [{ text: "hi", href: "", plain: true }],
      online: false, openProfile: () => {}, canReact: false, react: () => {}, reactions: [], hasReactions: false,
      hasProposal: false, proposal: "", proposalTitle: "", openProposal: () => {} },
  ],
  canWrite: true, draft: "half a thought", placeholder: "Say something…", send: () => {},
  sendLabel: "Send", footLine: "Public — anyone can read this", busy: true,
  busyLabel: "Waiting for the wallet…", notice: "Not sent", hasNotice: true, clearNotice: () => {},
  sheetOpen: true, sheetIdentity: true, sheetBring: true, sheetBackup: true,
  identityKind: "A key made in this browser.", canRename: true, cannotRename: true,
  nameDraft: "", saveName: () => {}, verifiedLine: "Verified member · ST2J8X…9K4T",
  verifiedOk: true, showVerify: true, verifyLabel: "Verify with your wallet", verify: () => {},
  openBring: () => {}, openBackup: () => {}, canBackup: true, nsec: "nsec1…", copyNsec: () => {},
  newKey: () => {}, hasExtension: true, noExtension: true, useExtension: () => {},
  useBunker: () => {}, useNsec: () => {}, startRemote: () => {}, cancelRemote: () => {},
  remoteWaiting: true, remoteWaitingNot: true, remoteUri: "nostrconnect://abc?relay=wss://r",
  copyRemote: () => {},
  showMembers: true, membersLine: "2 verified members · 1 online", openMembers: () => {},
  sheetMembers: true, sheetProfile: true,
  people: [{ pubkey: "ab", name: "Alice", color: "#333", online: true, onlineLabel: "online", isMe: true,
    member: true, linked: true, memberLabel: "Verified member", address: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
    addressShort: "ST1PQH…GZGM", explorer: "https://explorer.hiro.so/address/ST1?chain=testnet",
    npub: "npub1abc", npubShort: "npub1abc…", njump: "https://njump.me/nprofile1abc",
    open: () => {}, copyAddress: () => {}, copyKey: () => {} }],
  profile: { pubkey: "ab", name: "Alice", color: "#333", online: true, onlineLabel: "online", isMe: false,
    member: true, linked: true, memberLabel: "Verified member", address: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
    addressShort: "ST1PQH…GZGM", explorer: "https://explorer.hiro.so/address/ST1?chain=testnet",
    npub: "npub1abc", npubShort: "npub1abc…", njump: "https://njump.me/nprofile1abc",
    open: () => {}, copyAddress: () => {}, copyKey: () => {} },
  pickerOpen: true, pickerTitle: "React to Alice", pickerQuick: true,
  quick: [{ char: "👍", pick: () => {} }], emojis: [{ char: "🐝", name: "bee", pick: () => {} }],
  closePicker: () => {}, togglePicker: () => {},
});

for (const open of [false, true]) {
  chatMount!.replaceChildren();
  for (const node of renderChildren(chatTemplate!.content, chatScope(open), document as unknown as Document)) {
    chatMount!.appendChild(node);
  }
  const panel = chatMount!.innerHTML;
  check(!panel.includes("{{"), `chat panel (${open ? "open" : "closed"}) leaves no mustaches`);
  check(!/<sc-(for|if)/.test(panel), `chat panel (${open ? "open" : "closed"}) resolves every directive`);
  if (open) {
    for (const id of ["chat-log", "chat-input", "chat-name", "chat-bunker", "chat-nsec"]) {
      check(Boolean(chatMount!.querySelector(`#${id}`)), `the panel has #${id}`);
    }
    check(
      (chatMount!.querySelector("#chat-input") as HTMLTextAreaElement).textContent === "half a thought",
      "the composer carries the draft across a render",
    );
    check(
      chatMount!.querySelectorAll(".chat-bubble").length === 2 &&
        chatMount!.querySelectorAll(".chat-bubble a[href='https://x.y']").length === 1,
      "messages render, and a URL in one becomes a link",
    );
    check(chatMount!.querySelectorAll(".chat-msg-head").length === 1, "a follow-up from the same sender has no header");
    check(
      chatMount!.querySelectorAll(".chat-reaction").length === 1 &&
        chatMount!.querySelectorAll(".chat-picker-emoji").length === 2 &&
        chatMount!.querySelectorAll(".chat-person").length === 1 &&
        [...chatMount!.querySelectorAll(".chat-sheet code")].some((c) => c.textContent!.includes("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM")),
      "reactions, the emoji picker, the members list and a profile's address all render",
    );
    check(
      chatMount!.querySelectorAll("a.chat-out[href='https://njump.me/nevent1abc']").length === 1 &&
        Boolean(chatMount!.querySelector("a[href='https://njump.me/nevent1room']")),
      "a public message and the room itself link out to njump",
    );
  } else {
    check(Boolean(chatMount!.querySelector(".chat-fab")), "closed, the panel is a button");
  }
}
// The page offers the chat from every proposal.
check(
  (html.match(/\{\{ (p|sel)\.discuss \}\}/g) ?? []).length >= 2,
  "proposal cards and the detail view both open the discussion",
);

/// --- 3b. every local link resolves ------------------------------------------

const { existsSync } = await import("node:fs");
// `app.js` is a name the build resolves to a content-hashed file, so it is
// checked against dist/ in the bundle section rather than here.
const deadLinks = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
  .map((m) => m[1])
  // A binding is a URL the view model supplies at render time; there is no file
  // on disk to check it against.
  .filter((h) => !h.includes("{{"))
  .filter((h) => !/^(https?:|#|data:|mailto:)/.test(h))
  .map((h) => h.split("#")[0])
  .filter((h) => h && h !== "app.js" && !existsSync(h));
check(deadLinks.length === 0, `no dead local links${deadLinks.length ? ` (${[...new Set(deadLinks)].join(", ")})` : ""}`);

/// --- 3c. the naming rule ------------------------------------------------------

// The name is a word, not initials. Nothing on the site spells the S+B
// derivation out -- not in the copy, not as a lockup, not in the mark's
// description.
const pages = ["index.html", "media-kit.html", "analytics.html", "v1/index.html"].map((f) =>
  readFileSync(f, "utf8"),
);
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

/// --- 3e. the analytics page ------------------------------------------------------

// `analytics.html` is the other page this site actually runs: every deployment
// of this code, measured, plus the calls anyone at all may make. It is a second
// entry, a second view model and a second template, so everything asserted
// about the pool's page has to be asserted again here or it is asserted about
// half the site.
const analyticsHtml = readFileSync("analytics.html", "utf8");
const analyticsSource = readFileSync("src/analytics.ts", "utf8");
const chainSourceEarly = readFileSync("src/chain.ts", "utf8");

const keeperLoopVars = new Set(
  [...analyticsHtml.matchAll(/<sc-for[^>]*\sas="([^"]+)"/g)].map((m) => m[1]),
);
const keeperRoots = new Set(
  [...analyticsHtml.matchAll(/\{\{([^}]*)\}\}/g)]
    .map((m) => m[1].trim().split(".")[0])
    .filter((r) => r && r !== "true" && r !== "false" && !keeperLoopVars.has(r)),
);
const keeperMissing = [...keeperRoots].filter((r) => !new Set(keysOf(analyticsSource)).has(r));
check(
  keeperMissing.length === 0,
  `every analytics binding is supplied${keeperMissing.length ? ` (missing: ${keeperMissing.join(", ")})` : ""}`,
);

const keeperDom = parseHTML(analyticsHtml);
const keeperTemplate = keeperDom.document.getElementById("tpl") as unknown as HTMLTemplateElement | null;
const keeperMount = keeperDom.document.getElementById("app");
check(Boolean(keeperTemplate) && Boolean(keeperMount), "analytics.html has #tpl and #app");
check(
  Boolean(keeperDom.document.getElementById("notice")),
  "and a notice bar outside the template, so a re-render cannot clear it",
);

// A stat tile, a log row and a deployment row are each one shape used in
// several places, so one fixture apiece covers all of them.
const tile = (label: string) => ({ label, value: "0.5 BTC · 50,000,000 sats", note: "read from get-pool" });
const deposit = (ready: boolean) => ({
  txidShort: "31c8e79500…2a3f9cbb",
  txid: "31c8e7950089a796c4dd88fa6468eba63870f07487a2eb8ace429a6d2a3f9cbb",
  txidLink: "https://mempool.bitcoin.regtest.hiro.so/tx/31c8",
  txidLinkShow: true,
  vout: "0",
  amount: "0.5 BTC · 50,000,000 sats",
  to: "bcrt1pjs9x…504g5rq",
  where: "bitcoin block 9,506",
  swept: ready ? "swept 0.4999 BTC at burn height 9,512" : "not swept yet",
  why: ready ? "Swept and uncredited." : "The sBTC signers have not swept it yet.",
  ready,
  complete: () => {},
});
const waitingRow = (ready: boolean, lapsed: boolean) => ({
  where: "vault-2",
  whereShow: true,
  member: "ST16H0KE0BPR4XNQ64115V5Y1V3XTPGMWG6F3CXQE",
  memberShort: "ST16H0…CXQE",
  memberLink: "https://explorer.hiro.so/txid/ST16H0KE?chain=testnet",
  amount: "0.5 BTC · 50,000,000 sats",
  stx: "25.00 STX",
  announced: "9,557",
  announcedAgo: "7 hours ago",
  addressShow: true,
  address: "bcrt1qs9kf0t5d5u6r7aklf33a0tquul57tpk8kjsd7w",
  addressShort: "bcrt1qs9kf0t5d5…kjsd7w",
  addressLink: "https://mempool.bitcoin.regtest.hiro.so/address/bcrt1qs9",
  addressLinkShow: true,
  script: "0x0014816c97ae8da7343f76df4c63d7ac1ce7e9e586c7",
  revealLink: "https://explorer.hiro.so/txid/0x0f57?chain=testnet",
  revealShow: true,
  word: ready ? "ready to credit" : lapsed ? "lapsed" : "waiting",
  wordBg: "var(--color-neutral-100)",
  wordFg: "var(--color-neutral-800)",
  lapses: lapsed ? "Its 2 days 18 hours are up — anyone may release it" : "Anyone may release it from burn height 10,557",
  releaseShow: lapsed,
  releaseDim: "1",
  releaseNote: "Hands the STX leg back to the member.",
  release: () => {},
  scanning: false,
  unscanned: false,
  blindShow: false,
  blind: "",
  noneFound: !ready && !lapsed,
  deposits: ready ? [deposit(true), deposit(false)] : [],
});

const keeperScope: Record<string, unknown> = {
  walletLabel: "Connect wallet",
  openWallet: () => {},
  walletNote: "A wallet is only needed to press one of these.",
  networks: [
    { label: "testnet", note: "", bg: "var(--color-accent)", fg: "var(--color-bg)", choose: () => {} },
    { label: "mainnet", note: "not deployed", bg: "transparent", fg: "var(--color-text)", choose: () => {} },
  ],
  burnShow: true,
  burnHeight: "9,663",
  pace: "a burn block is about 4 minutes here",
  reading: false,
  reload: () => {},
  failedShow: false,
  failed: "",
  deploymentsWord: "2 deployments",

  headline: [
    { label: "sBTC principal", value: "0.5 BTC", note: "50,000,000 sats the ledgers account for" },
    { label: "Open work", value: "3", note: "1 to credit · 1 to clear · 1 to execute" },
  ],

  manyShow: true,
  compare: [
    {
      label: "vault-2",
      pool: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.vault-2",
      poolShort: "STFCGF….vault-2",
      poolLink: "https://explorer.hiro.so/txid/x?chain=testnet",
      daoName: "esbee-dao-2",
      bridgeName: "bond-bridge-2",
      sats: "0.095 BTC",
      satsNote: "9,500,000 sats",
      ustx: "4.75 STX",
      epochs: "never staked",
      state: "a bond is bound",
      proposals: "0",
      work: "2",
      keeper: "bridge v2",
      keeperDim: "1",
      failedShow: false,
      failed: "",
      focused: true,
      focus: () => {},
    },
    {
      label: "vault-1",
      pool: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.vault-1",
      poolShort: "STFCGF….vault-1",
      poolLink: "https://explorer.hiro.so/txid/y?chain=testnet",
      daoName: "esbee-dao",
      bridgeName: "bond-bridge",
      sats: "0 BTC",
      satsNote: "0 sats",
      ustx: "0.00 STX",
      epochs: "never staked",
      state: "idle",
      proposals: "0",
      work: "0",
      keeper: "bridge v1 — no work list",
      keeperDim: "0.55",
      failedShow: false,
      failed: "",
      focused: false,
      focus: () => {},
    },
  ],

  workNote: "Each row was found in an event log and confirmed against the map it came from.",
  waitingCount: "2",
  waitingEmpty: false,
  waiting: [waitingRow(true, false), waitingRow(false, true)],
  holdingShow: true,
  holdingCount: "1",
  commitTtl: "2 hours",
  holding: [
    {
      where: "vault-2",
      whereShow: true,
      memberShort: "ST2PAB…2YCW",
      memberLink: "https://explorer.hiro.so/txid/z?chain=testnet",
      amount: "0.0001 BTC · 10,000 sats",
      stx: "0.01 STX",
      committed: "8,044",
      digest: "0x9f21ba5dd4…966ef6e4",
      when: "Its 2 hours are up — anyone may cancel it",
      cancelShow: true,
      cancel: () => {},
      txLink: "https://explorer.hiro.so/txid/w?chain=testnet",
      txShow: true,
    },
  ],

  picker: [
    { label: "vault-2", bg: "var(--color-accent)", fg: "var(--color-bg)", choose: () => {} },
    { label: "vault-1", bg: "transparent", fg: "var(--color-text)", choose: () => {} },
  ],
  focusLabel: "vault-2",
  focusPool: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.vault-2",
  focusPoolLink: "https://explorer.hiro.so/txid/x?chain=testnet",
  focusDao: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.esbee-dao-2",
  focusDaoLink: "https://explorer.hiro.so/txid/d?chain=testnet",
  focusBridge: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.bond-bridge-2",
  focusBridgeLink: "https://explorer.hiro.so/txid/b?chain=testnet",

  sheetShow: true,
  sheet: [tile("In the bond"), tile("Queued"), tile("Honey recognised")],
  extrasShow: true,
  extras: [tile("Treasury balance"), tile("Unattributed")],
  syncShow: true,
  syncNote: "Permissionless.",
  sync: () => {},

  rollShow: true,
  rollEligible: "0.095 BTC · 9,500,000 sats",
  rollFits: "0.095 BTC · 9,500,000 sats",
  rollScale: "100.0%",
  rollUstx: "4.75 STX",
  rollShort: "the STX leg covers it",
  rollLimit: "nothing is holding it back",
  rollWindow: "The stake window opens at burn height 10,512.",
  bondShow: true,
  bondIndex: "4",
  bondStart: "Starts at burn height 10,800",
  bondRoom: "1 BTC · 100,000,000 sats allocated to this pool",
  scheduleShow: true,
  scheduleNow: "Bond 3 is running.",
  scheduleNext: "Bond 4 opens at burn height 10,800",
  poolShareShow: true,
  poolShare: "12.5% of every sat staked into bond 3",

  epochsShow: true,
  epochsEmpty: false,
  epochsNote: "2 epochs opened, 0.01 BTC of honey credited across them",
  epochs: [
    {
      index: "1",
      bond: "4",
      staked: "0.5 BTC · 50,000,000 sats",
      ustx: "25.00 STX",
      scale: "92.0%",
      scaleNote: "0.04 BTC · 4,000,000 sats was released rather than carried",
      shares: "0.5 BTC · 50,000,000 sats",
      sharesNote: "nobody has left mid-term",
      credited: "0.005 BTC · 500,000 sats",
      yield: "1.0%",
      cycle: "212",
      unlock: "21,600 in 5 days",
    },
  ],

  activityShow: true,
  activityNote: "The last 6 events vault-2 printed. 2 principals appear in it.",
  activity: [tile("Deposits"), tile("Withdrawals")],
  recent: [
    {
      what: "Deposited",
      who: "ST16H0…CXQE",
      whoLink: "https://explorer.hiro.so/txid/v?chain=testnet",
      whoShow: true,
      sats: "0.045 BTC · 4,500,000 sats",
      ustx: "2.25 STX",
      txLink: "https://explorer.hiro.so/txid/u?chain=testnet",
    },
  ],

  bridgeShow: true,
  bridgeBlocked: false,
  bridgeBlockedNote: "",
  funnel: [tile("Commitments"), tile("Reveals"), tile("Credited")],
  bridgeLogNote: "The last 10 events bond-bridge-2 printed, newest first.",
  bridgeLog: [
    {
      what: "Revealed it",
      who: "ST16H0…CXQE",
      whoLink: "https://explorer.hiro.so/txid/v?chain=testnet",
      amount: "0.5 BTC · 50,000,000 sats",
      stx: "25.00 STX",
      txLink: "https://explorer.hiro.so/txid/u?chain=testnet",
      btcShow: true,
      btcShort: "31c8e79500…cbb",
      btcLink: "https://mempool.bitcoin.regtest.hiro.so/tx/31c8",
    },
  ],

  floorNote: "4 proposals raised, quorum 7,254 by weight, epoch 0",
  floorCounts: [tile("Executed"), tile("Carried, unspent"), tile("Open"), tile("Expired")],
  floorQuiet: false,
  floorQuietNote: "Nothing is open for a vote.",
  readyShow: true,
  readyCount: "1",
  ready: [
    {
      id: "3",
      kind: "trust-signer",
      proposer: "ST16H0…CXQE",
      votes: "9,000 for · 100 against · quorum 7,254",
      window: "Executable from burn height 9,600, 4 hours ago",
      execute: () => {},
    },
  ],
  openShow: true,
  open: [
    {
      id: "4",
      kind: "sweep",
      votes: "10 for · 0 against",
      turnout: "0.1% of quorum",
      closes: "Voting closes at burn height 9,900, in 16 hours",
    },
  ],

  checksShow: true,
  checksNote: "The properties the pool's own test suite holds it to.",
  checks: [
    { name: "paid within credited", holds: "holds", bg: "var(--color-accent-2-100)", fg: "var(--color-accent-2-800)" },
  ],

  network: "testnet",
  btcChain: "regtest",
  btcApiShow: true,
  btcApi: "https://mempool.bitcoin.regtest.hiro.so/api",
  nodeApi: "https://api.testnet.hiro.so",
  windowNote: "Every count on this page is over the last 200 events.",
};

for (const child of renderChildren(keeperTemplate!.content, keeperScope, keeperDom.document as unknown as Document)) {
  keeperMount!.appendChild(child);
}
const keeperOut = keeperMount!.innerHTML;
const keeperText = keeperMount!.textContent!.replace(/\s+/g, " ");
check(keeperOut.length > 8_000, `the analytics page renders ${keeperOut.length} bytes`);
check(!keeperOut.includes("{{"), "analytics: no unresolved mustaches remain");
check(!/<sc-(for|if)/.test(keeperOut), "analytics: no unresolved sc-for / sc-if remain");
check(!keeperOut.includes("sc-camel-"), "analytics: no sc-camel-* attributes survive");
check(!keeperOut.includes("hint-placeholder"), "analytics: canvas-only hints are dropped");

// What the page is *for*, in the words it uses to say so. Half its value is in
// naming the calls a stranger is allowed to make and half is in refusing to
// derive anything, so a rewrite that loses either is a rewrite worth catching.
for (const phrase of [
  "This code, wherever it is deployed",
  "no annualisation",
  "Side by side",
  "Open work",
  "permissionless",
  "Credit it to the pool",
  "Release the address",
  "Commitments never revealed",
  "Carried and waiting to be executed",
  "Execute it",
  "Sync rewards",
  "The ledger of",
  "What the next roll would commit",
  "Every epoch it has rolled through",
  "The bridge, end to end",
]) {
  check(keeperText.includes(phrase), `the analytics page says "${phrase}"`);
}

// Two deposits under one announcement: one ready, one not. Only the ready one
// gets a button -- offering the other would be a transaction that reverts.
check(
  (keeperOut.match(/Credit it to the pool/g) ?? []).length === 1,
  "and offers the credit only on the deposit the bridge would take",
);
// Every row of the work list says which deployment it belongs to. Without that
// the page would offer a call against whichever pool happened to be focused.
check(
  (keeperOut.match(/vault-2/g) ?? []).length >= 4,
  "and names the deployment each row belongs to",
);

const keeperDead = [...analyticsHtml.matchAll(/(?:href|src)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((h) => !h.includes("{{"))
  .filter((h) => !/^(https?:|#|data:|mailto:)/.test(h))
  .map((h) => h.split("#")[0])
  .filter((h) => h && h !== "analytics.js" && !existsSync(h));
check(
  keeperDead.length === 0,
  `analytics: no dead local links${keeperDead.length ? ` (${[...new Set(keeperDead)].join(", ")})` : ""}`,
);

// A directive is an unknown element, and the HTML parser foster-parents an
// unknown element out of a `<tbody>` and in front of the table -- so a
// `<sc-for>` written inside one renders every row *outside* the table. It looks
// like a styling bug, and it cost a rewrite of this page's log once already.
for (const [name, page] of [
  ["index.html", html],
  ["analytics.html", analyticsHtml],
  ["v1/index.html", readFileSync("v1/index.html", "utf8")],
] as const) {
  const tables = [...page.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
  check(
    tables.every((table) => !/<sc-(for|if)/.test(table)),
    `${name}: no template directive inside a <table>, which the parser would hoist out`,
  );
}

// The five calls the page exists to offer, and the site each is made against.
// Named against `chain.ts` rather than against the page's own text, so renaming
// one in the chain layer breaks this rather than leaving a button that throws.
for (const call of [
  "bridgeCalls.complete",
  "bridgeCalls.cancelDeposit",
  "bridgeCalls.cancelCommitment",
  "poolCalls.syncRewards",
  "executorFor",
]) {
  check(analyticsSource.includes(call), `the analytics page can reach ${call}`);
}
// The whole argument of the work list: the log finds candidates, the map decides.
check(
  analyticsSource.includes("announcementByScript") && analyticsSource.includes("bridgeLog"),
  "and confirms every candidate from the log against the bridge's own map",
);
check(
  chainSourceEarly.includes('"get-announcement-by-script"'),
  "chain.ts can ask the bridge about a script the events carried",
);

// Several deployments, and every read pointed at the one it belongs to. A
// loader that reached for `config` instead of its argument would silently
// report the primary's numbers under every label.
check(
  /export function deployments\(\): Deployment\[\]/.test(configSource),
  "config.ts offers the whole list of deployments, not just the configured one",
);
check(
  configSource.includes('params.get("deployments")'),
  "and ?deployments= names others for a visit",
);
check(
  chainSourceEarly.includes("export type Site = Deployment") &&
    chainSourceEarly.includes("export const here = (): Site"),
  "chain.ts takes a deployment per call, defaulting to the configured one",
);
for (const loader of [
  "loadPool(site: Site = here())",
  "loadFloor(site: Site = here())",
  "capabilities(site: Site = here())",
  "epochHistory(",
]) {
  check(chainSourceEarly.includes(loader), `and ${loader.split("(")[0]} reads the one it is given`);
}
// "The same code" is never quite the same code -- testnet's two bridges already
// differ -- so the page asks before it reads.
check(
  analyticsSource.includes('can.bridge.has("get-announcement-by-script")'),
  "the analytics page asks each deployment what it can do before reading it",
);
// The page is reachable. A page nothing links to is a page nobody keeps.
check(
  html.includes('href="analytics.html"'),
  "and the pool's page links to it",
);

/// --- 4. the chain layer is wired to the real contract -------------------------

const chainSource = readFileSync("src/chain.ts", "utf8");
for (const fn of [
  "propose-trust-signer", "propose-distrust-signer", "propose-signer-change",
  "propose-operator-change", "propose-sweep", "vote",
  "execute-trust-signer", "execute-distrust-signer", "execute-operator-change",
  "execute-sweep", "execute-signer-change",
  "get-proposal", "get-status", "get-vote", "get-weight", "get-quorum",
  "get-proposal-count", "current-epoch",
  // vault-2's own: the early exit, what it would cost, and the permissionless
  // call that banks the rewards it would otherwise forfeit.
  "unstake-sbtc-early", "get-early-unstake-preview", "sync-rewards",
  // bridge v2: the address is what is committed to, and completing a deposit
  // takes the transaction and its parents rather than a bare txid.
  "commit-btc-address", "reveal-btc-address", "complete-btc-deposit",
  "get-address-digest", "get-address-script", "cancel-btc-deposit",
]) {
  check(chainSource.includes(`"${fn}"`), `chain.ts calls ${fn}`);
}
for (const gone of ["commit-btc-deposit", "reveal-btc-deposit", "confirm-btc-deposit"]) {
  check(!chainSource.includes(`"${gone}"`), `chain.ts no longer calls ${gone}`);
}
for (const fn of [] as string[]) {
  check(chainSource.includes(`"${fn}"`), `chain.ts calls ${fn}`);
}
check(chainSource.includes("@stacks/connect"), "chain.ts uses @stacks/connect for the wallet");
check(chainSource.includes('"stx_signMessage"'), "chain.ts can sign a message, which is how a chat key is vouched for");

// The public room is a real NIP-28 channel, pinned by id, so it exists outside
// this page. Two networks, two channels; both ids are 32 bytes of hex.
const nostrSource = readFileSync("src/nostr.ts", "utf8");
for (const network of ["testnet", "mainnet"]) {
  check(
    new RegExp(`${network}: "[0-9a-f]{64}"`).test(nostrSource),
    `nostr.ts pins the ${network} channel id`,
  );
}
check(nostrSource.includes("https://njump.me/"), "and links messages out to njump");
check(
  nostrSource.includes("KIND_REACTION = 7") && nostrSource.includes("KIND_DELETE = 5"),
  "public reactions are NIP-25, taken back with NIP-09",
);
check(
  /KIND_PRESENCE = 2\d{4}/.test(nostrSource),
  "presence is an ephemeral kind, so no relay keeps it",
);

/// --- 4b. the chat verifies wallets without stacks.js ---------------------------------

// `stacks-verify.ts` re-implements the little of stacks.js the chat needs --
// the signed-message hash, signature recovery, c32 addresses, a principal in,
// a tuple out -- so that reading the public room never loads the wallet SDK.
// Here it is held against the real thing. A detail drifting (the varint, the
// address alphabet, a leading zero byte) would otherwise show up as every
// member silently failing to verify.
{
  const { hashMessage: refHash, getPublicKeyFromPrivate } = await import("@stacks/encryption");
  const {
    signMessageHashRsv, getAddressFromPublicKey, Cl, cvToHex, addressFromVersionHash, addressToString,
  } = await import("@stacks/transactions");
  const {
    hashMessage, signerOf, verifyAddressSignature, principalHex, decodeClarity, c32address,
    VERSION_MAINNET, VERSION_TESTNET,
  } = await import("./src/stacks-verify.js");
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));

  let agree = 0;
  const ROUNDS = 40;
  for (let i = 0; i < ROUNDS; i++) {
    const priv = hex(crypto.getRandomValues(new Uint8Array(32)));
    const pub = getPublicKeyFromPrivate(priv);
    const text = `Esbee DAO — member chat\n\nround ${i} ✓ ${"·".repeat(i * 7)}`;
    const sig = signMessageHashRsv({ messageHash: hex(refHash(text)), privateKey: priv });
    const onTestnet = getAddressFromPublicKey(pub, "testnet");
    const onMainnet = getAddressFromPublicKey(pub, "mainnet");
    const flipped = sig.slice(0, 128) + (sig.endsWith("00") ? "01" : "00");
    if (
      hex(hashMessage(text)) === hex(refHash(text)) &&
      signerOf(text, sig, VERSION_TESTNET) === onTestnet &&
      signerOf(text, sig, VERSION_MAINNET) === onMainnet &&
      verifyAddressSignature(text, sig, onTestnet) &&
      !verifyAddressSignature(`${text}!`, sig, onTestnet) &&
      verifyAddressSignature(text, flipped, onTestnet, pub) &&
      principalHex(onTestnet) === cvToHex(Cl.principal(onTestnet))
    ) {
      agree++;
    }
  }
  check(agree === ROUNDS, `stacks-verify agrees with stacks.js on ${agree}/${ROUNDS} random keys`);

  // The case a random key almost never produces: a hash that starts with zero
  // bytes, which c32 has to spell out.
  const zeroed = "00000000000000000000000000000000000000ab";
  check(
    c32address(26, unhex(zeroed)) === addressToString(addressFromVersionHash(26, zeroed)),
    "c32 keeps leading zero bytes",
  );
  const record = Cl.some(Cl.tuple({ shares: Cl.uint(5), "bonded-sats": Cl.uint(0), "queued-sats": Cl.uint(12), flag: Cl.bool(false), tail: Cl.none(), who: Cl.principal("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM") }));
  const decoded = decodeClarity(cvToHex(record)) as Record<string, unknown>;
  check(
    decoded.shares === 5n && decoded["queued-sats"] === 12n && decoded.flag === false && decoded.tail === null &&
      decoded.who === "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
    "the member record the chat reads decodes by hand",
  );
}
check(chainSource.includes("@stacks/transactions"), "chain.ts uses @stacks/transactions for Clarity values");

/// --- 5. the wallet SDK stays out of the initial load -------------------------

// The whole point of splitting `chain.ts` out: stacks.js and the wallet SDK are
// ~1.4 MB, and a reader who never connects should not download them. If someone
// makes the chain import static again this is the check that notices.
const entryFile = built("dist") ? readdirSync("dist").find((f) => /^app-[A-Z0-9]+\.js$/.test(f)) : undefined;
if (entryFile) {
  const eager = new Set<string>();
  const walk = (file: string): number => {
    if (eager.has(file) || !built(`dist/${file}`)) return 0;
    eager.add(file);
    const text = readFileSync(`dist/${file}`, "utf8");
    let bytes = statSync(`dist/${file}`).size;
    for (const m of text.matchAll(/(?:from|import)"\.\/([^"]+)"/g)) bytes += walk(m[1]);
    return bytes;
  };
  const eagerBytes = walk(entryFile);
  const totalBytes = readdirSync("dist")
    .filter((f) => f.endsWith(".js"))
    .reduce((n, f) => n + statSync(`dist/${f}`).size, 0);

  // A ceiling on the page's own code, not a target: what it is really guarding
  // is the two assertions below it -- that neither the wallet SDK nor the chat's
  // network layer has crept into the initial load. It moves when the page
  // genuinely grows (~61 kB with the L1 route and the early exit, ~69 kB once
  // the L1 card said where the member is and why in words, ~74 kB once the two
  // deposit cards became one flow, ~76 kB once the L1 route became a stepper
  // that can be read backwards, ~83 kB once the route was scoped to the account
  // holding it) and should be read as "something heavy leaked" rather than "the
  // page got bigger".
  check(
    eagerBytes < 88_000,
    `initial load is ${(eagerBytes / 1024).toFixed(1)} kB of ${(totalBytes / 1024).toFixed(0)} kB built`,
  );
  check(
    !readFileSync(`dist/${entryFile}`, "utf8").includes("@stacks"),
    "the wallet SDK is not in the entry chunk",
  );
  // The chat's relays and curves are the same kind of weight, loaded the same
  // way: after the page has painted.
  const eagerText = [...eager].map((f) => readFileSync(`dist/${f}`, "utf8")).join("");
  check(!eagerText.includes("wss://"), "the relays are not in the initial load either");
  check(
    readdirSync("dist").some((f) => /^nostr-[A-Z0-9]+\.js$/.test(f)),
    "and the chat's network layer is a chunk of its own",
  );
  // What Netlify publishes has to name the hashed bundle, not the placeholder.
  const deployed = readFileSync("dist/index.html", "utf8");
  check(deployed.includes(`src="${entryFile}"`), "dist/index.html names the hashed entry");
  check(!deployed.includes('src="app.js"'), "and not the unhashed placeholder");
  // The keeper's page is a second entry beside it, hashed and rewritten the
  // same way -- and built from the same chunks, which is why it is one esbuild
  // call and not two.
  const keeperEntry = readdirSync("dist").find((f) => /^analytics-[A-Z0-9]+\.js$/.test(f));
  check(Boolean(keeperEntry), "dist/ has a hashed analytics entry");
  const keeperDeployed = readFileSync("dist/analytics.html", "utf8");
  check(
    Boolean(keeperEntry) && keeperDeployed.includes(`src="${keeperEntry}"`),
    "dist/analytics.html names it",
  );
  check(!keeperDeployed.includes('src="analytics.js"'), "and not the unhashed placeholder");
  for (const asset of ["styles.css", "esbee.svg", "fonts", "icons"]) {
    check(built(`dist/${asset}`), `dist/ carries ${asset}`);
  }
} else {
  ok.push("skipped bundle checks (run `pnpm run build` first)");
}

/// --- 6. the retired vault has a page of its own ------------------------------

// `v1/` is a copy of the site pointed at `vault-1`, and the only thing anyone
// should be able to do there is take their money out. Three things are worth
// asserting: the two copies really are pointed at different contracts, the copy
// has no way in, and its template resolves the same way the live one does.
const v1Html = readFileSync("v1/index.html", "utf8");
const v1App = readFileSync("v1/src/app.ts", "utf8");
const v1Config = readFileSync("v1/src/config.ts", "utf8");
const rootConfig = readFileSync("src/config.ts", "utf8");

check(/pool: "vault-2"/.test(rootConfig), "the live page is pointed at vault-2");
check(/retired: "vault-1"/.test(rootConfig), "and knows which vault it replaced");
check(/pool: "vault-1"/.test(v1Config), "v1/ is pointed at vault-1");
check(/successor: "vault-2"/.test(v1Config), "and knows where the live one is");

// Nothing this page signs may ask for permission to move anything at all.
// Every call either names what the member sends, or says that they send
// nothing -- so `allow`, which asks for both, has no business in here.
const signing = readFileSync("src/chain.ts", "utf8");
check(
  !/postConditionMode[^\n]*allow/.test(signing) && !/"allow"/.test(signing),
  "no call is signed in allow mode",
);
check(
  signing.includes('mode ?? (conditions === undefined ? ("originator" as const)'),
  "and a call with no conditions says the member sends nothing, rather than anything",
);

// The whole point of the copy. A deposit call reachable from the retired page
// would be money walking into a contract everyone is leaving.
for (const call of ["poolCalls.deposit", "bridgeCalls.commit", "poolCalls.stake"]) {
  check(!v1App.includes(call), `v1/ cannot ${call.split(".")[1]}`);
}
for (const call of [
  "poolCalls.withdraw", "poolCalls.requestExit",
  "poolCalls.claimPrincipal", "poolCalls.claimRewards",
]) {
  check(v1App.includes(call), `v1/ can ${call.split(".")[1]}`);
}

const v1LoopVars = new Set(
  [...v1Html.matchAll(/<sc-for[^>]*\sas="([^"]+)"/g)].map((m) => m[1]),
);
const v1Roots = new Set(
  [...v1Html.matchAll(/\{\{([^}]*)\}\}/g)]
    .map((m) => m[1].trim().split(".")[0])
    .filter((r) => r && r !== "true" && r !== "false" && !v1LoopVars.has(r)),
);
const v1Supplied = new Set([
  ...keysOf(v1App),
  ...keysOf(readFileSync("v1/src/chat.ts", "utf8")),
]);
const v1Missing = [...v1Roots].filter((r) => !v1Supplied.has(r));
check(
  v1Missing.length === 0,
  `every v1 template binding is supplied${v1Missing.length ? ` (missing: ${v1Missing.join(", ")})` : ""}`,
);

const v1Dom = parseHTML(v1Html);
const v1Template = v1Dom.document.getElementById("tpl") as unknown as HTMLTemplateElement | null;
const v1Mount = v1Dom.document.getElementById("app");
check(Boolean(v1Template) && Boolean(v1Mount), "v1/index.html has #tpl and #app");

const v1Scope: Record<string, unknown> = {
  ...scope,
  poolName: "vault-1",
  poolContract: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.vault-1",
  poolLink: "https://explorer.hiro.so/txid/STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.vault-1?chain=testnet",
  successor: "vault-2",
  bridge: { reveal: () => {}, confirm: () => {}, cancel: () => {} },
  exit: {
    contract: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.vault-1",
    contractName: "vault-1",
    contractLink: "https://explorer.hiro.so/txid/STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM.vault-1",
    successor: "vault-2",
    connected: true, disconnected: true, connect: () => {},
    wrongNetwork: true, networkWarning: "Your wallet is a mainnet address",
    unstakedSats: "0.1000 BTC", unstakedUstx: "5.00 STX",
    hasUnstaked: true, noUnstaked: true, withdraw: () => {},
    committedSats: "0.0000 BTC", committedUstx: "0.00 STX",
    hasCommitted: true, exiting: true, notExiting: true,
    exitNote: "Your exit is queued.", requestExit: () => {}, cancelExit: () => {},
    releasedSats: "0.0000 BTC", releasedUstx: "0.00 STX",
    hasReleased: true, claimPrincipal: () => {},
    rewards: "0.0000 BTC", hasRewards: true, claimRewards: () => {},
    empty: true, emptyNote: "This address holds nothing in vault-1",
    pendingShow: true, pendingText: "In the mempool.",
    pendingTxid: "0x1234…abcd", pendingLink: "https://explorer.hiro.so/txid/0x1234",
  },
};

for (const node of renderChildren(
  v1Template!.content,
  v1Scope,
  v1Dom.document as unknown as Document,
)) {
  v1Mount!.appendChild(node);
}
const v1Out = v1Mount!.innerHTML;
const v1Text = v1Mount!.textContent!.replace(/\s+/g, " ");

check(!v1Out.includes("{{"), "v1: no unresolved mustaches remain");
check(!/<sc-(for|if)/.test(v1Out), "v1: no unresolved sc-for / sc-if remain");
for (const phrase of [
  "This is vault-1, the retired vault",
  "Take your funds out",
  "Withdraw sBTC and STX",
  "Unstaked sBTC",
  "Unstaked STX",
]) {
  check(v1Text.includes(phrase), `v1 keeps "${phrase}"`);
}
check(!v1Text.includes("Deposit sBTC"), "v1 offers no way in");
check(v1Out.includes('href="../index.html"'), "v1 links back to the live vault");

// The copy reaches up for the stylesheet and the mark rather than duplicating
// them, so its links resolve from `v1/`, not from here.
const v1Dead = [...v1Html.matchAll(/(?:href|src)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((h) => !h.includes("{{"))
  .filter((h) => !/^(https?:|#|data:|mailto:)/.test(h))
  .map((h) => h.split("#")[0])
  .filter((h) => h && h !== "app.js" && !existsSync(`v1/${h}`));
check(v1Dead.length === 0, `v1 has no dead local links${v1Dead.length ? ` (${[...new Set(v1Dead)].join(", ")})` : ""}`);

if (built("dist/v1")) {
  const v1Entry = readdirSync("dist/v1").find((f) => /^app-[A-Z0-9]+\.js$/.test(f));
  check(Boolean(v1Entry), "dist/v1/ has a hashed entry of its own");
  const v1Deployed = readFileSync("dist/v1/index.html", "utf8");
  check(v1Deployed.includes(`src="${v1Entry}"`), "dist/v1/index.html names it");
  // Separate bundles, so the contract each page is pointed at cannot leak
  // across a chunk they both loaded. Read out of what was actually built,
  // because that is the only place the two can be seen to differ.
  const poolOf = (dir: string): string[] =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .flatMap((f) => [...readFileSync(`${dir}/${f}`, "utf8").matchAll(/pool:"([^"]+)"/g)])
      .map((m) => m[1]);
  check(
    poolOf("dist/v1").includes("vault-1") && !poolOf("dist/v1").includes("vault-2"),
    "and the retired page's bundle is built against vault-1",
  );
  // The live bundle knows about `vault-1` now -- the analytics page reads every
  // deployment, and the retired one is on the list. What still has to hold is
  // the *order*: `config` is the first entry, so a list that led with the
  // retired vault would point the pool page, the join card and every post
  // condition at the contract everyone is leaving.
  const livePools = poolOf("dist");
  check(
    livePools.indexOf("vault-2") !== -1 &&
      (livePools.indexOf("vault-1") === -1 ||
        livePools.indexOf("vault-2") < livePools.indexOf("vault-1")),
    "while the live page's bundle leads with vault-2",
  );
} else {
  ok.push("skipped v1 bundle checks (run `pnpm run build` first)");
}

/// --- report ---------------------------------------------------------------------

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of fail) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
