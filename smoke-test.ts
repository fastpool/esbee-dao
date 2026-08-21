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
const pages = ["index.html", "media-kit.html", "v1/index.html"].map((f) =>
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

  check(
    eagerBytes < 60_000,
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
  check(
    poolOf("dist").includes("vault-2") && !poolOf("dist").includes("vault-1"),
    "while the live page's is built against vault-2",
  );
} else {
  ok.push("skipped v1 bundle checks (run `pnpm run build` first)");
}

/// --- report ---------------------------------------------------------------------

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of fail) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
