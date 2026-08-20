// The discussion, end to end: the built site, a relay of our own, and a few
// browser profiles talking to each other.
//
//   pnpm run build && pnpm run chat:e2e
//
// Nothing here touches a public relay. `chat-relay.mjs` is an in-memory relay
// on localhost, the page is pointed at it with `?relays=`, and the pool's
// membership read is answered by the test so the members room can be walked
// through without a wallet: two profiles are given bindings signed by fresh
// Stacks keys, a third is left out, and the relay is checked afterwards to hold
// nothing but ciphertext. Screenshots land in `shots/chat-*.png`.
//
// Chrome comes from Playwright's cache, as `pnpm run shot` does; the browser
// driver is playwright-core, a devDependency that does not ship a browser.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { WebSocket } from "ws";
import { startRelay } from "./chat-relay.mjs";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { hashMessage, getPublicKeyFromPrivate } from "@stacks/encryption";
import { signMessageHashRsv, getAddressFromPublicKey, Cl, cvToHex } from "@stacks/transactions";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RELAY_PORT = 7447;
const HTTP_PORT = 8124;
const SHOTS = join(REPO, "shots");
mkdirSync(SHOTS, { recursive: true });

const fails = [];
const ok = (cond, label) => { console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}`); if (!cond) fails.push(label); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

if (!existsSync(join(REPO, "dist", "index.html"))) {
  console.error("dist/ is not built. Run `pnpm run build` first.");
  process.exit(1);
}
const relay = startRelay(RELAY_PORT);
const server = spawn("python3", ["-m", "http.server", String(HTTP_PORT), "--bind", "127.0.0.1"], { cwd: join(REPO, "dist"), stdio: "ignore" });
await sleep(800);

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
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const URL = `http://127.0.0.1:${HTTP_PORT}/?relays=ws://127.0.0.1:${RELAY_PORT}`;

// The pool, mocked: every address the chat asks about holds 5 shares.
const memberRecord = cvToHex(Cl.some(Cl.tuple({ shares: Cl.uint(5), "bonded-sats": Cl.uint(500), "queued-sats": Cl.uint(0) })));
const errors = [];
async function profile(name, viewport = { width: 1180, height: 900 }) {
  const context = await browser.newContext({ viewport });
  // Everything else on chain: let the page's own fallbacks handle it quickly.
  // (Registered first: Playwright runs later routes first.)
  await context.route(/api\.testnet\.hiro\.so\/(v2|extended)\//, (route) => route.fulfill({ status: 503, body: "{}" }));
  await context.route("**/v2/contracts/call-read/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ okay: true, result: memberRecord }) }));
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(URL);
  await page.waitForSelector(".chat-fab");
  return { context, page, name };
}

const bindingMessage = (npub, address, network) => [
  "Esbee DAO — member chat", "",
  "I hold this Stacks address and I am linking it to my chat identity.", "",
  `address: ${address}`, `chat key: ${npub}`, `network: ${network}`,
].join("\n");

async function identityOf(page) {
  const raw = await page.evaluate(() => localStorage.getItem("esbee:chat:identity"));
  const stored = JSON.parse(raw);
  const secret = Uint8Array.from(stored.secret.match(/../g).map((x) => parseInt(x, 16)));
  return { secret, pubkey: getPublicKey(secret) };
}

async function publishBinding(page) {
  const { secret, pubkey } = await identityOf(page);
  const stxPriv = hex(crypto.getRandomValues(new Uint8Array(32))) + "01";
  const stxPub = getPublicKeyFromPrivate(stxPriv);
  const address = getAddressFromPublicKey(stxPub, "testnet");
  const text = bindingMessage(nip19.npubEncode(pubkey), address, "testnet");
  const signature = signMessageHashRsv({ messageHash: hex(hashMessage(text)), privateKey: stxPriv });
  const event = finalizeEvent({
    kind: 30078, created_at: Math.floor(Date.now() / 1000),
    tags: [["d", "esbee-dao:member:testnet"], ["t", "esbee-dao"]],
    content: JSON.stringify({ v: 1, address, signature, publicKey: stxPub, network: "testnet" }),
  }, secret);
  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}`);
    ws.on("open", () => { ws.send(JSON.stringify(["EVENT", event])); setTimeout(() => { ws.close(); resolve(); }, 200); });
  });
  return { address, pubkey };
}

const open = async (p) => { await p.page.click(".chat-fab"); await p.page.waitForSelector(".chat-panel"); };
const statusOf = (p) => p.page.textContent(".chat-head .text-muted");
const waitLive = async (p) => {
  for (let i = 0; i < 40; i++) { if ((await statusOf(p)).startsWith("Live")) return true; await sleep(250); }
  return false;
};
const say = async (p, text) => { await p.page.fill("#chat-input", text); await p.page.press("#chat-input", "Enter"); };
const bubbles = (p) => p.page.$$eval(".chat-bubble", (els) => els.map((e) => e.textContent));
const waitText = async (p, text, tries = 40) => {
  for (let i = 0; i < tries; i++) { if ((await bubbles(p)).some((b) => b.includes(text))) return true; await sleep(250); }
  return false;
};

try {
  const A = await profile("A");
  const B = await profile("B");
  await sleep(1200); // the unread boundary is a whole second

  // 1. A opens, connects, says something. B, closed, sees the unread badge.
  await open(A);
  ok(await waitLive(A), `A is live (${await statusOf(A)})`);
  await A.page.screenshot({ path: join(SHOTS, "chat-01-open-empty.png") });
  await say(A, "hello from A — https://esbee-dao.org is the place");
  ok(await waitText(A, "hello from A"), "A sees its own message");
  ok((await A.page.$$(".chat-bubble a")).length === 1, "the URL in it is a link");
  const out = await A.page.$eval("a.chat-out", (a) => a.getAttribute("href")).catch(() => null);
  ok(out && out.startsWith("https://njump.me/nevent1"), `the message links out to njump (${out})`);
  const roomLink = await A.page.$eval(".chat-head a", (a) => a.getAttribute("href")).catch(() => null);
  ok(roomLink && roomLink.startsWith("https://njump.me/nevent1"), "and so does the room");
  await sleep(1500);
  const badge = await B.page.textContent(".chat-badge").catch(() => null);
  ok(badge === "1", `B's closed button shows 1 unread (got ${badge})`);
  await B.page.screenshot({ path: join(SHOTS, "chat-02-b-badge.png"), clip: { x: 900, y: 780, width: 280, height: 120 } });

  // 2. B opens, sees A's message under A's alias, replies; A sees it.
  await open(B);
  ok(await waitLive(B), "B is live");
  ok(await waitText(B, "hello from A"), "B sees A's message");
  const aAlias = await B.page.textContent(".chat-name");
  ok(/^bee-[0-9a-f]{4}$/.test(aAlias), `A appears under an alias (${aAlias})`);
  await say(B, "hi A, B here");
  ok(await waitText(A, "hi A, B here"), "A sees B's reply");
  await say(B, "second line from B");
  ok(await waitText(A, "second line from B"), "and a second one");
  const heads = await A.page.$$eval(".chat-msg-head", (els) => els.length);
  ok(heads === 2, `consecutive messages from B share one header (${heads} headers for 3 messages)`);
  // Reactions: A reacts to B's line via the quick bar; B sees it; B adds one; A takes its own back.
  await A.page.hover(".chat-msg >> nth=1");
  await A.page.click(".chat-msg >> nth=1 >> button[title='React']");
  await A.page.waitForSelector(".chat-picker-quick");
  await A.page.click(".chat-picker-quick button:has-text('🐝')");
  const chip = async (p) => (await p.page.$$eval(".chat-reaction", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim())));
  const waitChip = async (p, text) => { for (let i = 0; i < 40; i++) { if ((await chip(p)).includes(text)) return true; await sleep(250); } return false; };
  ok(await waitChip(A, "🐝 1"), "A's reaction shows as a chip");
  ok(await waitChip(B, "🐝 1"), "B sees A's reaction");
  await B.page.click(".chat-reaction:has-text('🐝')");
  ok(await waitChip(A, "🐝 2"), "B joins it from the chip and A sees two");
  await A.page.click(".chat-reaction:has-text('🐝')");
  ok(await waitChip(B, "🐝 1"), "A takes its own back and B sees one (NIP-09 deletion)");
  ok(relay.events.some((e) => e.kind === 7 && e.content === "🐝") && relay.events.some((e) => e.kind === 5), "the relay saw a kind 7 and a kind 5");
  // Shortcodes and the composer picker.
  await say(A, "sweet :honey: and :+1:");
  ok(await waitText(B, "sweet 🍯 and 👍"), "shortcodes become emoji on send");
  await A.page.click(".chat-emoji-btn");
  await A.page.waitForSelector(".chat-picker-grid");
  await A.page.click(".chat-picker-grid button[title='bee']");
  ok((await A.page.inputValue("#chat-input")) === "🐝", "the picker puts an emoji in the composer");
  await A.page.fill("#chat-input", "");
  // Presence: both pages have said they are here.
  await A.page.waitForSelector(".chat-msg-head .chat-online");
  const onlineDots = await A.page.$$eval(".chat-msg-head .chat-online", (els) => els.length);
  ok(onlineDots >= 1, `A sees B online next to B's name (${onlineDots} dots)`);
  await A.page.screenshot({ path: join(SHOTS, "chat-03-conversation.png") });

  // 3. A sets a name; B sees it live.
  await A.page.click(".chat-me");
  await A.page.waitForSelector("#chat-name");
  await A.page.screenshot({ path: join(SHOTS, "chat-04-identity-sheet.png") });
  await A.page.fill("#chat-name", "Alice");
  await A.page.click("#chat button:has-text(\"Save\")");
  await sleep(1500);
  const names = await B.page.$$eval(".chat-name", (els) => els.map((e) => e.textContent));
  ok(names.includes("Alice"), `B sees A's new name (${names.join(", ")})`);
  ok((await A.page.textContent(".chat-me")).includes("Alice"), "A's own chip shows the name");

  // 4. The backup sheet shows an nsec; bring-your-own shows its options.
  await A.page.click(".chat-me");
  await A.page.click("#chat button:has-text(\"Back up this key\")");
  const nsec = await A.page.textContent(".chat-sheet code");
  ok(nsec.startsWith("nsec1"), "backup shows the nsec");
  await A.page.click("button:text-is('Back')");
  await A.page.click("#chat button:has-text(\"Bring your own key\")");
  await A.page.waitForSelector("#chat-bunker");
  await A.page.screenshot({ path: join(SHOTS, "chat-05-bring-key.png") });
  ok(Boolean(await A.page.$("#chat-nsec")), "bring sheet has the nsec field");
  await A.page.keyboard.press("Escape");
  ok(!(await A.page.$("#chat-bunker")), "Escape closes the sheet");

  // 5. Members room: gate first (no wallet), then bindings make A and B members.
  await A.page.click("#chat .chat-tabs button:has-text(\"Members\")");
  await A.page.waitForSelector(".chat-gate");
  ok((await A.page.textContent(".chat-gate")).includes("Connect a wallet"), "without a wallet the members room asks for one");
  await A.page.screenshot({ path: join(SHOTS, "chat-06-members-gate.png") });

  const a = await publishBinding(A.page);
  const b = await publishBinding(B.page);
  await sleep(2000);
  ok(Boolean(await A.page.$("#chat-input")) && !(await A.page.$(".chat-gate")), "with a verified binding A can write in the members room");
  const foot = await A.page.textContent(".chat-foot");
  ok(foot.includes("Sealed to 2 verified members"), `footer counts the members (${foot})`);
  await say(A, "members only: the signer change looks fine to me");
  ok(await waitText(A, "members only"), "A sees its sealed message");
  await B.page.click("#chat .chat-tabs button:has-text(\"Members\")");
  ok(await waitText(B, "members only"), "B opens the sealed message");
  await B.page.screenshot({ path: join(SHOTS, "chat-07-members-room.png") });

  // Who is here: the list, and a profile with address and key.
  await A.page.click("#chat button:has-text('who is here')");
  await A.page.waitForSelector(".chat-person");
  const persons = await A.page.$$eval(".chat-person", (els) => els.length);
  ok(persons === 2, `the members list shows both verified members (${persons})`);
  const listOnline = await A.page.$$eval(".chat-person .chat-online", (els) => els.length);
  ok(listOnline === 2, `both are online (${listOnline})`);
  await A.page.screenshot({ path: join(SHOTS, "chat-10-members.png") });
  await A.page.click(".chat-person >> nth=1");
  await A.page.waitForSelector(".chat-sheet code");
  const codes = await A.page.$$eval(".chat-sheet code", (els) => els.map((e) => e.textContent));
  ok(codes.some((c) => c === a.address || c === b.address) && codes.some((c) => c.startsWith("npub1")), `the profile shows a Stacks address and an npub`);
  const explorer = await A.page.$eval(".chat-sheet a:has-text('Explorer')", (el) => el.getAttribute("href"));
  ok(explorer.startsWith("https://explorer.hiro.so/address/ST") && explorer.endsWith("chain=testnet"), `and links the address to the explorer`);
  await A.page.screenshot({ path: join(SHOTS, "chat-11-profile.png") });
  await A.page.keyboard.press("Escape");
  // Sealed reaction in the members room: B reacts, A sees it, C's relay copy is ciphertext.
  await B.page.hover(".chat-msg >> nth=0");
  await B.page.click(".chat-msg >> nth=0 >> button[title='React']");
  await B.page.click(".chat-picker-quick button:has-text('👍')");
  ok(await waitChip(A, "👍 1"), "a sealed reaction reaches the other member");
  const sealedIds = new Set(relay.events.filter((e) => e.kind === 4242).map((e) => e.id));
  ok(sealedIds.size === 2 && !relay.events.some((e) => e.kind === 7 && e.tags.some((t) => t[0] === "e" && sealedIds.has(t[1]))), "and went out sealed, not as a public kind 7");

  // Public room shows the member badge now.
  await B.page.click("#chat .chat-tabs button:has-text(\"Public\")");
  await sleep(300);
  const badges = await B.page.$$eval(".chat-member", (els) => els.length);
  ok(badges >= 1, `members are badged in the public room (${badges})`);

  // 6. A stranger C: can read public, cannot read the members room.
  const C = await profile("C");
  await open(C);
  ok(await waitLive(C), "C is live");
  ok(await waitText(C, "hello from A"), "C reads the public room");
  const publicTextsC = await bubbles(C);
  ok(!publicTextsC.some((t) => t.includes("members only")), "the sealed message is not in C's public room");
  await C.page.click(".chat-msg-head .chat-name >> nth=0");
  await C.page.waitForSelector(".chat-sheet code");
  ok((await C.page.textContent(".chat-sheet")).includes("Verified member"), "a stranger can open a member's profile from their name");
  await C.page.keyboard.press("Escape");
  await C.page.click("#chat .chat-tabs button:has-text(\"Members\")");
  await C.page.waitForSelector(".chat-gate");
  ok(!(await bubbles(C)).some((t) => t.includes("members only")), "C cannot read the members room");
  // And the relay really holds only ciphertext.
  const sealed = relay.events.find((e) => e.kind === 4242);
  ok(sealed && !sealed.content.includes("members only") && sealed.tags.filter((t) => t[0] === "wrap").length === 2,
    "the relay holds ciphertext wrapped to exactly the two members");
  ok(relay.events.filter((e) => e.kind === 42).length === 4, "four public messages reached the relay");
  ok(
    relay.events.filter((e) => e.kind === 42).every((e) => e.tags.some((t) => t[0] === "e" && t[1] === "52b9144d60dddd16559b924cdbfa9404549a03dba0932d48f41013ba1a19114a" && t[3] === "root")),
    "each rooted at the pinned testnet channel",
  );

  // 7. Discuss from a proposal card; the topic filters and tags.
  await C.page.click("#chat .chat-tabs button:has-text(\"Public\")");
  await C.page.keyboard.press("Escape");
  await C.page.click("#app button:has-text(\"Discuss\") >> nth=0");
  await C.page.waitForSelector(".chat-topic");
  const topic = await C.page.textContent(".chat-topic");
  ok(topic.includes("#4"), `discuss opens the panel on the proposal (${topic.trim().slice(0, 40)})`);
  await say(C, "what about the roll timing?");
  ok(await waitText(C, "roll timing"), "a message sent on a topic shows in the topic");
  await C.page.click("#chat button:has-text(\"all messages\")");
  await sleep(300);
  const refs = await C.page.$$eval(".chat-msg .chat-ref", (els) => els.map((e) => e.textContent));
  ok(refs.some((r) => r.includes("#4")), "and carries the proposal as a chip in the full log");
  await C.page.screenshot({ path: join(SHOTS, "chat-08-topic.png") });

  // 8. A phone.
  const M = await profile("M", { width: 390, height: 800 });
  await open(M);
  await waitLive(M);
  await waitText(M, "hello from A");
  await M.page.screenshot({ path: join(SHOTS, "chat-09-mobile.png") });
  let box = 0;
  for (let i = 0; i < 10 && box !== 390; i++) {
    box = await M.page.$eval(".chat-panel", (el) => el.getBoundingClientRect().width).catch(() => -1);
    if (box !== 390) await sleep(200);
  }
  ok(box === 390, `on a phone the panel fills the screen (${box}px)`);
  const order = await bubbles(M);
  ok(order.indexOf("hi A, B here") < order.indexOf("second line from B"), "a fresh load keeps two quick lines in order");

  // 9. Reload keeps identity and name.
  await A.page.reload();
  await A.page.waitForSelector(".chat-fab");
  await open(A);
  await waitLive(A);
  ok((await A.page.textContent(".chat-me")).includes("Alice"), "after a reload A is still Alice");
  const { pubkey } = await identityOf(A.page);
  ok(pubkey === a.pubkey, "with the same key");
} catch (error) {
  fails.push(`threw: ${error.stack}`);
  console.log(error);
} finally {
  const real = errors.filter((e) => !/503|Failed to load resource|ERR_FAILED|net::/.test(e));
  ok(real.length === 0, `no console errors${real.length ? `:\n    ${real.join("\n    ")}` : ""}`);
  await browser.close();
  server.kill();
  relay.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
}
