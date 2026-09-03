// The discussion panel.
//
// A place to talk about the proposals, on the page that shows them. Two rooms:
// one anyone can read and write, and one for members -- verified, which means
// a wallet holding a position in the pool has signed for the chat identity.
//
// It works the moment the page opens. A reader gets an identity made in this
// browser, no sign-up, and can say something straight away; the Nostr relays
// underneath are a detail they never have to meet. `nostr.ts` holds all of
// that and is loaded after the page has painted, so the first paint costs what
// it did before.
//
// Rendered on its own, outside `#app`, from its own template: the page
// re-renders on every state change and would otherwise wipe the log out from
// under a reader mid-sentence. What has to survive a re-render here -- the
// log's scroll position, the caret in the composer, half-typed fields -- is
// carried across by hand in `render()`.
import { mountInto, type Scope } from "./render.js";
import { config, net } from "./config.js";
import type {
  Binding,
  ChatBackend,
  ChatMessage,
  Identity,
  Reaction,
  Room,
  Status,
} from "./nostr.js";

/// --- what the page provides ---------------------------------------------------------

/** What the chat needs from the page around it. */
export interface ChatHost {
  /** The connected Stacks address, when there is one. */
  account: string | null;
  connected: boolean;
  /** Whether there is a deployment to ask about membership. */
  configured: boolean;
  proposals: { id: number; title: string }[];
  openWallet(): void;
  signMessage(message: string): Promise<{ signature: string; publicKey: string }>;
  showProposal(id: number): void;
}

/// --- state ----------------------------------------------------------------------

type Sheet = "none" | "identity" | "bring" | "backup" | "members" | "profile";

/** Where a picked emoji goes: into the composer, or onto a message. */
type Picker = { for: "draft" } | { for: "message"; id: string } | null;

interface Known {
  address: string;
  /** The pool's answer, or null while it could not be asked. */
  member: boolean | null;
}

interface State {
  open: boolean;
  room: Room;
  topic: number | null;
  /** The composer's text, held so a re-render can put it back. */
  draft: string;
  /** Other fields the sheets read, kept the same way, by element id. */
  fields: Record<string, string>;
  messages: Map<string, ChatMessage>;
  reactions: Map<string, Reaction>;
  names: Map<string, string>;
  bindings: Map<string, Known>;
  /** When each key's page last said it was open, in seconds. */
  presence: Map<string, number>;
  /** Whose profile sheet is open. */
  profileOf: string;
  picker: Picker;
  me: Identity | null;
  status: Status;
  loading: boolean;
  failed: string;
  sheet: Sheet;
  /**
   * Whether the backup sheet is actually showing the secret.
   *
   * Opening a sheet called "Back up this key" is not the same as asking for the
   * key to be on screen. The sheet gets opened in rooms, on trains, and on a
   * shared screen, and a secret that anyone holding it can write as you should
   * not arrive uninvited -- so it starts covered every time and takes a
   * deliberate press to uncover.
   */
  nsecShown: boolean;
  notice: string;
  busy: string;
  lastSeen: number;
  remoteUri: string;
  remoteAbort: AbortController | null;
}

const STORE_SEEN = "esbee:chat:seen";
const STORE_NAME = "esbee:chat:name";
const SHOWN = 200;

/**
 * What stands in for the secret key while it is covered.
 *
 * `nsec1` and then a fixed run of dots: enough for a reader to recognise what
 * is behind the cover, and not so much as to say how long the real one is.
 */
const NSEC_MASK = `nsec1${"•".repeat(26)}`;

const state: State = {
  open: false,
  room: "public",
  topic: null,
  draft: "",
  fields: {},
  messages: new Map(),
  reactions: new Map(),
  names: new Map(),
  bindings: new Map(),
  presence: new Map(),
  profileOf: "",
  picker: null,
  me: null,
  status: { relays: 0, total: 0, synced: false },
  loading: true,
  failed: "",
  sheet: "none",
  nsecShown: false,
  notice: "",
  busy: "",
  lastSeen: Number(localStorage.getItem(STORE_SEEN) ?? 0) || Math.floor(Date.now() / 1000),
  remoteUri: "",
  remoteAbort: null,
};

let backend: ChatBackend | null = null;
let host: (() => ChatHost) | null = null;

function setState(patch: Partial<State>): void {
  Object.assign(state, patch);
  render();
}

/// --- names and looks ----------------------------------------------------------------

/** A name a reader can say, with nothing set: the key's first four characters. */
const alias = (pubkey: string): string => `bee-${pubkey.slice(0, 4)}`;
const nameOf = (pubkey: string): string => state.names.get(pubkey) ?? alias(pubkey);
/** One hue per key, so the same person looks the same in every message. */
const colorOf = (pubkey: string): string =>
  `hsl(${parseInt(pubkey.slice(0, 6), 16) % 360} 48% 42%)`;

const shortKey = (npub: string): string => `${npub.slice(0, 12)}…${npub.slice(-6)}`;
const shortAddress = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function when(seconds: number): string {
  const d = new Date(seconds * 1000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay ? hm : `${MONTHS[d.getMonth()]} ${d.getDate()} · ${hm}`;
}

/** Text split at links, so a URL is a link and everything else is text. */
function parts(text: string): { text: string; href: string; plain: boolean }[] {
  const out: { text: string; href: string; plain: boolean }[] = [];
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), href: "", plain: true });
    out.push({ text: m[0], href: m[0], plain: false });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), href: "", plain: true });
  return out;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/// --- emoji ---------------------------------------------------------------------------

/** The picker's grid: a hive's worth, then the usual. */
const EMOJI: { char: string; name: string }[] = [
  ["🐝", "bee"], ["🍯", "honey"], ["🪙", "coin"], ["₿", "bitcoin"], ["🗳️", "ballot"], ["⚖️", "scales"],
  ["👍", "thumbs up"], ["👎", "thumbs down"], ["👏", "clap"], ["🙏", "thanks"], ["🤝", "handshake"], ["👀", "eyes"],
  ["❤️", "heart"], ["🔥", "fire"], ["✅", "check"], ["❌", "cross"], ["❓", "question"], ["❗", "exclamation"],
  ["😀", "grin"], ["😂", "joy"], ["😅", "sweat smile"], ["😉", "wink"], ["😊", "blush"], ["🙂", "smile"],
  ["🤔", "thinking"], ["🤨", "raised eyebrow"], ["😐", "neutral"], ["😬", "grimace"], ["🙄", "eye roll"], ["😢", "cry"],
  ["😮", "open mouth"], ["🤯", "mind blown"], ["🥳", "party"], ["😎", "cool"], ["🫡", "salute"], ["🤷", "shrug"],
  ["🎉", "tada"], ["🚀", "rocket"], ["💡", "idea"], ["⏳", "hourglass"], ["⏰", "alarm"], ["📈", "chart up"],
  ["📉", "chart down"], ["🔒", "lock"], ["🔑", "key"], ["🧱", "brick"], ["🛠️", "tools"], ["📜", "scroll"],
  ["☀️", "sun"], ["🌙", "moon"], ["⭐", "star"], ["🌱", "seedling"], ["🌻", "sunflower"], ["🍀", "clover"],
  ["☕", "coffee"], ["🍺", "beer"], ["🎯", "target"], ["🏁", "finish"], ["👋", "wave"], ["💬", "speech"],
].map(([char, name]) => ({ char, name }));

/** `:bee:` in a message becomes 🐝 when it is sent. */
const SHORTCODES: Record<string, string> = Object.fromEntries([
  ...EMOJI.map(({ char, name }) => [name.replace(/ /g, "_"), char]),
  ["+1", "👍"], ["-1", "👎"], ["thumbsup", "👍"], ["thumbsdown", "👎"], ["ok", "✅"], ["x", "❌"],
  ["sats", "🪙"], ["btc", "₿"], ["stx", "🧱"], ["honeypot", "🍯"], ["hive", "🐝"], ["lol", "😂"],
  ["yes", "✅"], ["no", "❌"], ["heart", "❤️"], ["vote", "🗳️"],
]);

const withEmoji = (text: string): string =>
  text.replace(/(^|[\s(])?:([a-z0-9_+-]{1,20}):/gi, (all, lead: string | undefined, code: string) => {
    const found = SHORTCODES[code.toLowerCase()];
    return found ? `${lead ?? ""}${found}` : all;
  });

/** The reactions offered first, before the whole grid. */
const QUICK = ["👍", "❤️", "🐝", "🍯", "👀", "🤔", "✅", "🎉"];

/** What is in a sheet's field: the element if it is on screen, else what was typed into it last. */
const field = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value ?? state.fields[id] ?? "";

/// --- who is who ----------------------------------------------------------------------

const myKnown = (): Known | null => (state.me ? (state.bindings.get(state.me.pubkey) ?? null) : null);

/** Verified members: a wallet has signed for the key and the pool says yes. */
const memberKeys = (): string[] =>
  [...state.bindings].filter(([, k]) => k.member === true).map(([pubkey]) => pubkey);

const isMemberKey = (pubkey: string): boolean => state.bindings.get(pubkey)?.member === true;

/**
 * Whether a message in the members room should be shown: its sender has been
 * vouched for, and the pool has not said no. Unknown -- the pool unreachable
 * -- is shown rather than hidden, since the text could only be read at all
 * because a member sealed it to this key.
 */
const fromMember = (pubkey: string): boolean => {
  const known = state.bindings.get(pubkey);
  return Boolean(known) && known!.member !== false;
};

const canReadMembers = (): boolean => Boolean(state.me?.canEncrypt) && myKnown()?.member === true;

const PRESENCE_TTL = 120;
const online = (pubkey: string): boolean =>
  Math.floor(Date.now() / 1000) - (state.presence.get(pubkey) ?? 0) < PRESENCE_TTL;

const explorerAddress = (address: string): string =>
  `${net().explorer}/address/${address}?chain=${config.network}`;

/** Reactions on one message, grouped by emoji, in first-seen order. */
function reactionsOn(id: string): { emoji: string; who: string[]; mine: Reaction | null }[] {
  const groups = new Map<string, { emoji: string; who: string[]; mine: Reaction | null }>();
  const me = state.me?.pubkey;
  for (const r of state.reactions.values()) {
    if (r.to !== id) continue;
    const group = groups.get(r.emoji) ?? { emoji: r.emoji, who: [], mine: null };
    if (!group.who.includes(r.pubkey)) group.who.push(r.pubkey);
    if (r.pubkey === me) group.mine = r;
    groups.set(r.emoji, group);
  }
  return [...groups.values()];
}

/// --- messages in view -------------------------------------------------------------------

function visible(): ChatMessage[] {
  const list = [...state.messages.values()]
    .filter((m) => m.room === state.room)
    .filter((m) => state.room === "public" || fromMember(m.pubkey))
    .filter((m) => state.topic === null || m.proposal === state.topic)
    // By time, and within a second by arrival -- the Map keeps that order and
    // the sort is stable, so two quick lines from one person stay in sequence.
    .sort((a, b) => a.at - b.at);
  return list.slice(-SHOWN);
}

function unreadCount(): number {
  const me = state.me?.pubkey;
  let n = 0;
  for (const m of state.messages.values()) {
    if (m.at <= state.lastSeen || m.pubkey === me) continue;
    if (m.room === "members" && !canReadMembers()) continue;
    n++;
  }
  return n;
}

function markSeen(): void {
  let latest = state.lastSeen;
  for (const m of state.messages.values()) if (m.at > latest) latest = m.at;
  const now = Math.floor(Date.now() / 1000);
  state.lastSeen = Math.max(latest, now);
  localStorage.setItem(STORE_SEEN, String(state.lastSeen));
}

/// --- actions ---------------------------------------------------------------------------

function toggle(): void {
  const open = !state.open;
  if (open) markSeen();
  setState({ open, sheet: "none", notice: "" });
  if (open) {
    void load();
    focusComposer();
  }
}

/** Open the panel on one proposal, from its card on the page. */
/**
 * The bee this reader posts as, for the profile the rest of the page shows.
 *
 * The chat's own identity is a nostr key, not the wallet's: it is made in this
 * browser and only *linked* to an address once the member signs for it. That
 * makes it a thing a member has to be able to find outside the chat panel --
 * a name they did not choose to see somewhere they were not looking is how a
 * pseudonym becomes a surprise.
 *
 * `null` until the network layer is loaded, which is after the page paints.
 */
export function beeIdentity(): {
  name: string;
  npub: string;
  npubShort: string;
  color: string;
  address: string;
  member: boolean | null;
} | null {
  const me = state.me;
  if (!me) return null;
  const npub = backend?.npub(me.pubkey) ?? "";
  const known = myKnown();
  return {
    name: nameOf(me.pubkey),
    npub,
    npubShort: npub ? shortKey(npub) : "",
    color: colorOf(me.pubkey),
    address: known?.address ?? "",
    member: known ? known.member : null,
  };
}

export function discuss(id: number): void {
  markSeen();
  setState({ open: true, topic: id, sheet: "none", notice: "" });
  void load();
  focusComposer();
}

function focusComposer(): void {
  window.setTimeout(() => {
    (document.getElementById("chat-input") as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
  }, 30);
}

function show(room: Room): void {
  if (room === state.room) return;
  setState({ room, sheet: "none", notice: "" });
  focusComposer();
}

async function send(): Promise<void> {
  const text = withEmoji(state.draft).trim();
  if (!text || !backend || state.busy) return;
  if (state.room === "members" && !canReadMembers()) return;
  try {
    setState({ busy: "sending" });
    const sent = await backend.send(state.room, text, state.topic, memberKeys());
    state.messages.set(sent.id, sent);
    state.draft = "";
    markSeen();
    setState({ busy: "", notice: "" });
    focusComposer();
  } catch (error) {
    setState({ busy: "", notice: `Not sent: ${message(error)}` });
  }
}

/**
 * Put an emoji on a message, or take yours off it again. Adding the same one
 * twice is a no-op rather than a second reaction.
 */
async function react(id: string, emoji: string): Promise<void> {
  const msg = state.messages.get(id);
  if (!msg || !backend || !state.me) return;
  if (msg.room === "members" && !canReadMembers()) return;
  const mine = [...state.reactions.values()].find(
    (r) => r.to === id && r.emoji === emoji && r.pubkey === state.me!.pubkey,
  );
  setState({ picker: null });
  try {
    if (mine) {
      state.reactions.delete(mine.id);
      render();
      await backend.unreact(mine, memberKeys());
    } else {
      const sent = await backend.react(msg, emoji, memberKeys());
      state.reactions.set(sent.id, sent);
      render();
    }
  } catch (error) {
    setState({ notice: `Reaction not sent: ${message(error)}` });
  }
}

/** The picker, for the composer or for a message. Clicking the same place again closes it. */
function togglePicker(target: Picker): void {
  const same =
    state.picker && target && state.picker.for === target.for &&
    (target.for !== "message" || (state.picker as { id?: string }).id === target.id);
  setState({ picker: same ? null : target });
}

function pick(char: string): void {
  const target = state.picker;
  if (!target) return;
  if (target.for === "message") {
    void react(target.id, char);
    return;
  }
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  const start = input?.selectionStart ?? state.draft.length;
  const end = input?.selectionEnd ?? start;
  state.draft = `${state.draft.slice(0, start)}${char}${state.draft.slice(end)}`;
  render();
  const after = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  if (after) {
    after.focus({ preventScroll: true });
    after.setSelectionRange(start + char.length, start + char.length);
  }
}

/**
 * Tie this chat key to the connected wallet.
 *
 * One signature, and the wallet shows the text before signing it: the address,
 * the chat key, the network. Everyone else's browser checks that signature and
 * asks the pool whether the address holds a position. Nothing is sent to us.
 */
async function verify(): Promise<void> {
  const h = host?.();
  if (!backend || !h || !state.me) return;
  if (!h.configured) {
    return setState({ notice: "There is no deployment on this network to check membership against." });
  }
  if (!h.account) {
    h.openWallet();
    return;
  }
  try {
    setState({ busy: "verifying", notice: "Confirm the message in your wallet…" });
    const { signature, publicKey } = await h.signMessage(backend.bindingText(h.account));
    const binding = await backend.publishBinding(h.account, signature, publicKey);
    const { isMember } = await import("./nostr.js");
    const member = await isMember(binding.address);
    state.bindings.set(binding.pubkey, { address: binding.address, member });
    setState({
      busy: "",
      notice:
        member === true
          ? "Verified. The members room is open to you."
          : member === false
            ? `Linked to ${shortAddress(binding.address)}, but that address holds no position in the pool yet.`
            : `Linked to ${shortAddress(binding.address)}. The pool could not be asked just now — try again in a moment.`,
    });
  } catch (error) {
    setState({ busy: "", notice: `Not verified: ${message(error)}` });
  }
}

/** Ask the pool again about the bound address -- after a deposit, say. */
async function recheckMine(): Promise<void> {
  const known = myKnown();
  if (!known || !state.me) return;
  const { isMember } = await import("./nostr.js");
  // Straight past the cache: the reader just did something on chain.
  const member = await isMember(known.address);
  state.bindings.set(state.me.pubkey, { address: known.address, member });
  setState({
    notice:
      member === true
        ? "Verified. The members room is open to you."
        : member === false
          ? "Still no position on that address."
          : "The pool could not be asked just now.",
  });
}

async function saveName(): Promise<void> {
  const name = field("chat-name").trim().slice(0, 40);
  if (!backend || !state.me || !name) return;
  state.names.set(state.me.pubkey, name);
  localStorage.setItem(`${STORE_NAME}:${state.me.pubkey}`, name);
  setState({ sheet: "none", notice: "" });
  try {
    await backend.setName(name);
  } catch (error) {
    setState({ notice: `The name is kept here, but could not be published: ${message(error)}` });
  }
}

async function adoptIdentity(run: () => Promise<Identity> | Identity, busy: string): Promise<void> {
  if (!backend) return;
  try {
    setState({ busy, notice: "" });
    const me = await run();
    rememberName(me);
    // A pasted secret or bunker URL has done its work; do not keep it around.
    state.fields = {};
    setState({ busy: "", sheet: "none", notice: `You are now ${nameOf(me.pubkey)}.` });
  } catch (error) {
    setState({ busy: "", notice: message(error) });
  }
}

function rememberName(me: Identity): void {
  const kept = localStorage.getItem(`${STORE_NAME}:${me.pubkey}`);
  if (kept) state.names.set(me.pubkey, kept);
}

function startRemote(): void {
  if (!backend) return;
  state.remoteAbort?.abort();
  const abort = new AbortController();
  const { uri, done } = backend.connectRemote(abort.signal);
  setState({ remoteUri: uri, remoteAbort: abort, notice: "" });
  done.then(
    (me) => {
      rememberName(me);
      setState({ remoteUri: "", remoteAbort: null, sheet: "none", notice: `Connected. You are now ${nameOf(me.pubkey)}.` });
    },
    (error: unknown) => {
      if (abort.signal.aborted) return;
      setState({ remoteUri: "", remoteAbort: null, notice: `The signer did not connect: ${message(error)}` });
    },
  );
}

function cancelRemote(): void {
  state.remoteAbort?.abort();
  setState({ remoteUri: "", remoteAbort: null });
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setState({ notice: `${what} copied.` });
  } catch {
    setState({ notice: `Could not copy — select the ${what.toLowerCase()} and copy it by hand.` });
  }
}

/// --- loading the backend ------------------------------------------------------------

let loadingPromise: Promise<void> | null = null;

/** Bring the relays in. Once; safe to call from anywhere that needs them. */
function load(): Promise<void> {
  return (loadingPromise ??= (async () => {
    try {
      const { ChatBackend } = await import("./nostr.js");
      backend = new ChatBackend(config.network, {
        onMessage: (m) => {
          state.messages.set(m.id, m);
          if (state.open && m.pubkey === state.me?.pubkey) markSeen();
          schedule();
        },
        onProfile: (pubkey, name) => {
          // A name the reader set here wins over one fetched from the relays,
          // which may be older than their last save.
          if (pubkey === state.me?.pubkey && localStorage.getItem(`${STORE_NAME}:${pubkey}`)) return;
          state.names.set(pubkey, name);
          schedule();
        },
        onReaction: (r: Reaction) => {
          state.reactions.set(r.id, r);
          schedule();
        },
        onUnreaction: (ref) => {
          for (const [id, r] of state.reactions) {
            const byId = ref.id !== undefined && id === ref.id && r.pubkey === ref.pubkey;
            const byWhat =
              ref.id === undefined && r.pubkey === ref.pubkey && r.to === ref.to && r.emoji === ref.emoji;
            if (byId || byWhat) state.reactions.delete(id);
          }
          schedule();
        },
        onPresence: (pubkey, at) => {
          state.presence.set(pubkey, Math.max(state.presence.get(pubkey) ?? 0, at));
          schedule();
        },
        onBinding: (b: Binding, member) => {
          state.bindings.set(b.pubkey, { address: b.address, member });
          schedule();
        },
        onStatus: (s: Status) => {
          state.status = s;
          schedule();
        },
        onIdentity: (me: Identity) => {
          state.me = me;
          rememberName(me);
          schedule();
        },
      });
      await backend.restoreIdentity();
      backend.start();
      // Membership can lapse -- a withdrawal, an exit -- so ask again now and then.
      setInterval(() => void backend?.recheckMembers(), 10 * 60 * 1000);
      // Presence lapses too, without an event to say so.
      setInterval(() => {
        if (state.open) render();
      }, 30_000);
      setState({ loading: false });
    } catch (error) {
      setState({ loading: false, failed: message(error) });
    }
  })());
}

let frame = 0;
/** Coalesce a burst of events into one render. */
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

/// --- the view model ----------------------------------------------------------------------

function statusLine(): string {
  if (state.failed) return "Could not load the chat";
  if (state.loading) return "Loading…";
  const { relays, total, synced } = state.status;
  if (relays === 0) return synced ? "Offline — no relay reachable" : "Connecting…";
  return `Live · ${relays} of ${total} relays`;
}

function viewModel(): Scope {
  const h = host?.();
  const me = state.me;
  const known = myKnown();
  const members = memberKeys();
  const proposals = new Map((h?.proposals ?? []).map((p) => [p.id, p.title]));
  const titleOf = (id: number): string => proposals.get(id) ?? `Proposal #${id}`;
  const list = visible();
  const isMembers = state.room === "members";
  const verified = canReadMembers();
  const canWrite = !state.loading && !state.failed && Boolean(me) && (!isMembers || verified);
  const myName = me ? nameOf(me.pubkey) : "…";
  const nsec = backend?.exportSecret() ?? "";

  // The members room, before a reader is in it: what it is, and how in.
  let gateTitle = "Members only";
  let gateText =
    "Messages here are sealed to verified members of the pool — addresses with committed shares or a queued deposit. Link your wallet once to prove yours; the signature is checked by every reader, and nothing is sent anywhere but the relays.";
  let gateAction = "";
  let gateRun: () => void = () => {};
  if (!h?.configured) {
    gateText = "There is no deployment on this network, so there is nobody the pool can vouch for yet.";
  } else if (me && !me.canEncrypt) {
    gateText = "The key you brought cannot encrypt, so it cannot read this room. Bring one that can, or use a key made here.";
    gateAction = "Change identity";
    gateRun = () => setState({ sheet: "bring" });
  } else if (known && known.member === false) {
    gateTitle = `Linked to ${shortAddress(known.address)}`;
    gateText =
      "That address holds no position in the pool yet. Members are addresses with committed shares or a queued deposit — deposit, and check again.";
    gateAction = "Check again";
    gateRun = () => void recheckMine();
  } else if (known && known.member === null) {
    gateTitle = `Linked to ${shortAddress(known.address)}`;
    gateText = "The pool could not be asked whether that address is a member. Try again in a moment.";
    gateAction = "Check again";
    gateRun = () => void recheckMine();
  } else if (!h?.account) {
    gateAction = "Connect a wallet";
    gateRun = () => h?.openWallet();
  } else {
    gateAction = "Verify with your wallet";
    gateRun = () => void verify();
  }

  const unread = unreadCount();
  const seenHead = new Map<string, number>();
  const onlineMembers = members.filter(online).length;

  // Everyone a wallet has signed for, members first, then by name.
  const people = [...state.bindings]
    .map(([pubkey, k]) => ({ pubkey, ...k }))
    .sort((x, y) =>
      Number(y.member === true) - Number(x.member === true) ||
      Number(online(y.pubkey)) - Number(online(x.pubkey)) ||
      nameOf(x.pubkey).localeCompare(nameOf(y.pubkey)),
    );
  const person = (pubkey: string) => {
    const known = state.bindings.get(pubkey) ?? null;
    const npub = backend?.npub(pubkey) ?? "";
    return {
      pubkey,
      name: nameOf(pubkey),
      color: colorOf(pubkey),
      online: online(pubkey),
      onlineLabel: online(pubkey) ? "online" : "away",
      isMe: pubkey === me?.pubkey,
      member: known?.member === true,
      linked: Boolean(known),
      memberLabel: !known
        ? "Not linked to a wallet"
        : known.member === true
          ? "Verified member"
          : known.member === false
            ? "Linked · no position in the pool"
            : "Linked · membership unknown",
      address: known?.address ?? "",
      addressShort: known ? shortAddress(known.address) : "",
      explorer: known ? explorerAddress(known.address) : "",
      npub,
      npubShort: npub ? shortKey(npub) : "",
      njump: backend?.profileLink(pubkey) ?? "",
      open: () => setState({ sheet: "profile", profileOf: pubkey, notice: "" }),
      copyAddress: () => void copy(known?.address ?? "", "Address"),
      copyKey: () => void copy(npub, "Key"),
    };
  };
  const profile = state.profileOf ? person(state.profileOf) : null;
  const pickerFor = state.picker;
  const pickerTarget = pickerFor?.for === "message" ? state.messages.get(pickerFor.id) : null;

  return {
    chatOpen: state.open,
    chatClosed: !state.open,
    toggleChat: () => toggle(),
    unread: unread > 99 ? "99+" : String(unread),
    hasUnread: unread > 0,
    fabLabel: "Discuss",

    statusLine: statusLine(),
    roomLink: !isMembers && backend ? backend.roomLink() : "",
    hasRoomLink: !isMembers && Boolean(backend?.roomLink()),
    myName,
    myColor: me ? colorOf(me.pubkey) : "var(--color-neutral-400)",
    myKey: me ? shortKey(me.npub) : "",
    openIdentity: () => setState({ sheet: state.sheet === "identity" ? "none" : "identity", notice: "" }),
    closeSheet: () => setState({ sheet: "none", notice: "" }),

    tabs: {
      showPublic: () => show("public"),
      showMembers: () => show("members"),
      publicBg: isMembers ? "transparent" : "var(--color-accent)",
      publicFg: isMembers ? "var(--color-text)" : "var(--color-bg)",
      membersBg: isMembers ? "var(--color-accent)" : "transparent",
      membersFg: isMembers ? "var(--color-bg)" : "var(--color-text)",
      // The verified count is in the line under the tabs; the tab keeps short.
      membersNote: verified ? `${onlineMembers} online` : "verified wallets",
    },

    // Who is here. The list is the members room's; a profile opens from any name.
    showMembers: isMembers && verified,
    membersLine: `${members.length} verified ${members.length === 1 ? "member" : "members"} · ${onlineMembers} online`,
    openMembers: () => setState({ sheet: "members", notice: "" }),
    sheetMembers: state.sheet === "members",
    people: people.map((p) => person(p.pubkey)),
    sheetProfile: state.sheet === "profile" && Boolean(profile),
    profile,

    // Emoji: into the composer, or onto a message.
    pickerOpen: Boolean(pickerFor) && state.sheet === "none",
    pickerTitle: pickerTarget ? `React to ${nameOf(pickerTarget.pubkey)}` : "Add an emoji",
    pickerQuick: pickerFor?.for === "message",
    quick: QUICK.map((char) => ({ char, pick: () => pick(char) })),
    emojis: EMOJI.map(({ char, name }) => ({ char, name, pick: () => pick(char) })),
    closePicker: () => setState({ picker: null }),
    togglePicker: () => togglePicker({ for: "draft" }),

    hasTopic: state.topic !== null,
    topicId: state.topic ?? "",
    topicTitle: state.topic !== null ? titleOf(state.topic) : "",
    clearTopic: () => setState({ topic: null }),
    openTopic: () => {
      if (state.topic !== null) h?.showProposal(state.topic);
    },

    showGate: isMembers && !verified && !state.loading && !state.failed,
    gateTitle,
    gateText,
    gateAction,
    hasGateAction: Boolean(gateAction) && !state.busy,
    gateRun,
    showFailed: Boolean(state.failed),
    failedText: state.failed,
    showEmpty: !state.loading && !state.failed && list.length === 0 && (!isMembers || verified),
    emptyText: !state.status.synced
      ? "Listening for messages…"
      : state.topic !== null
        ? `Nothing about #${state.topic} yet. Start it.`
        : isMembers
          ? "Nothing here yet — or nothing sealed to your key. Say hello."
          : "Nobody has said anything yet. Be the first.",

    messages: list.map((m) => {
      const lastFromAuthor = seenHead.get(m.pubkey) ?? 0;
      // Consecutive messages from one person within five minutes read as one
      // turn, so the name is shown once.
      const showHead = m.at - lastFromAuthor > 300;
      seenHead.set(m.pubkey, m.at);
      const mine = m.pubkey === me?.pubkey;
      return {
        id: m.id,
        name: nameOf(m.pubkey),
        color: colorOf(m.pubkey),
        time: when(m.at),
        showHead,
        mine,
        bg: mine ? "var(--color-accent-200)" : "var(--color-surface)",
        member: !isMembers && isMemberKey(m.pubkey),
        parts: parts(m.text),
        link: m.link,
        hasLink: Boolean(m.link),
        online: online(m.pubkey),
        openProfile: () => setState({ sheet: "profile", profileOf: m.pubkey, notice: "" }),
        canReact: canWrite,
        react: () => togglePicker({ for: "message", id: m.id }),
        reactions: reactionsOn(m.id).map((g) => ({
          emoji: g.emoji,
          count: g.who.length,
          who: g.who.map(nameOf).join(", "),
          bg: g.mine ? "var(--color-accent-200)" : "var(--color-surface)",
          border: g.mine ? "var(--color-accent)" : "var(--color-divider)",
          toggle: () => void react(m.id, g.emoji),
        })),
        hasReactions: reactionsOn(m.id).length > 0,
        hasProposal: m.proposal !== null && state.topic === null,
        proposal: m.proposal ?? "",
        proposalTitle: m.proposal !== null ? titleOf(m.proposal) : "",
        openProposal: () => {
          if (m.proposal !== null) {
            setState({ topic: m.proposal });
            h?.showProposal(m.proposal);
          }
        },
      };
    }),

    canWrite,
    draft: state.draft,
    placeholder:
      state.topic !== null
        ? `Say something about #${state.topic}…`
        : isMembers
          ? "To the members…"
          : "Say something…",
    send: () => void send(),
    sendLabel: state.busy === "sending" ? "…" : "Send",
    footLine: isMembers
      ? `Sealed to ${members.length} verified ${members.length === 1 ? "member" : "members"} · as ${myName}`
      : `Public — anyone can read this · as ${myName}`,
    busy: Boolean(state.busy),
    notice: state.notice,
    hasNotice: Boolean(state.notice),
    clearNotice: () => setState({ notice: "" }),

    // The identity sheets.
    sheetIdentity: state.sheet === "identity",
    sheetBring: state.sheet === "bring",
    sheetBackup: state.sheet === "backup",
    sheetOpen: state.sheet !== "none",
    identityKind:
      me?.kind === "extension"
        ? "A key from your browser extension."
        : me?.kind === "remote"
          ? "A key held by a remote signer."
          : "A key made in this browser when you first opened the page. It is yours: back it up to use it elsewhere, or bring a key you already have.",
    canRename: me?.kind === "local",
    cannotRename: Boolean(me) && me!.kind !== "local",
    nameDraft: me ? (state.names.get(me.pubkey) ?? "") : "",
    saveName: () => void saveName(),
    verifiedLine: !known
      ? "Not linked to a wallet."
      : known.member === true
        ? `Verified member · ${shortAddress(known.address)}`
        : known.member === false
          ? `Linked to ${shortAddress(known.address)} · no position in the pool`
          : `Linked to ${shortAddress(known.address)} · membership unknown`,
    verifiedOk: known?.member === true,
    showVerify: Boolean(h?.configured) && Boolean(me?.canEncrypt) && known?.member !== true && !state.busy,
    verifyLabel: !h?.account ? "Connect a wallet to verify" : known ? "Verify again" : "Verify with your wallet",
    verify: () => (h?.account ? void verify() : h?.openWallet()),
    openBring: () => setState({ sheet: "bring", notice: "" }),
    openBackup: () => setState({ sheet: "backup", nsecShown: false, notice: "" }),
    canBackup: Boolean(nsec),
    // Masked by default, and the mask is a fixed shape rather than the real
    // one: a row of dots as long as the key would quietly publish its length.
    nsecText: state.nsecShown ? nsec : NSEC_MASK,
    nsecShown: state.nsecShown,
    nsecHidden: !state.nsecShown,
    toggleNsec: () => setState({ nsecShown: !state.nsecShown }),
    revealLabel: state.nsecShown ? "Hide the secret key" : "Show the secret key",
    // Copy works while it is still covered, which is the safer order: a member
    // can put the key straight into a password manager without it ever having
    // been on screen.
    copyNsec: () => void copy(nsec, "Secret key"),
    newKey: () => {
      if (confirm("Start over with a new key? Messages you sent stay under the old one, and it is gone from this browser unless you backed it up.")) {
        void adoptIdentity(() => backend!.newLocalKey(), "switching");
      }
    },
    hasExtension: Boolean((window as unknown as { nostr?: unknown }).nostr),
    noExtension: !(window as unknown as { nostr?: unknown }).nostr,
    useExtension: () => void adoptIdentity(() => backend!.useExtension(), "switching"),
    useBunker: () => void adoptIdentity(() => backend!.useBunker(field("chat-bunker")), "connecting"),
    useNsec: () => void adoptIdentity(() => backend!.useSecret(field("chat-nsec")), "switching"),
    startRemote: () => startRemote(),
    cancelRemote: () => cancelRemote(),
    remoteWaiting: Boolean(state.remoteUri),
    remoteWaitingNot: !state.remoteUri,
    remoteUri: state.remoteUri,
    copyRemote: () => void copy(state.remoteUri, "Connect link"),
    busyLabel:
      state.busy === "connecting"
        ? "Waiting for the signer…"
        : state.busy === "switching"
          ? "Switching…"
          : state.busy === "verifying"
            ? "Waiting for the wallet…"
            : "",
  };
}

/// --- rendering ------------------------------------------------------------------------

/**
 * Re-render the panel, carrying across what a reader would notice losing: how
 * far they had scrolled the log (or that they were at the bottom, where new
 * messages should keep them), the caret in whatever they were typing into,
 * and the text of the sheets' fields.
 */
export function render(): void {
  const template = document.getElementById("chat-tpl") as HTMLTemplateElement | null;
  const mount = document.getElementById("chat");
  if (!template || !mount) return;

  const log = document.getElementById("chat-log");
  const stick = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  const scrolled = log?.scrollTop ?? 0;
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const focused = active && mount.contains(active) ? active.id : "";
  const selection =
    focused && "selectionStart" in active!
      ? [active!.selectionStart ?? 0, active!.selectionEnd ?? 0]
      : null;

  mountInto(template, mount, viewModel());

  const next = document.getElementById("chat-log");
  if (next) next.scrollTop = stick ? next.scrollHeight : scrolled;

  for (const el of mount.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
    if (!el.id) continue;
    if (el.id === "chat-input") {
      el.value = state.draft;
      autosize(el as HTMLTextAreaElement);
      wireComposer(el as HTMLTextAreaElement);
    } else {
      if (el.id in state.fields) el.value = state.fields[el.id];
      el.addEventListener("input", () => {
        state.fields[el.id] = el.value;
      });
    }
  }
  if (focused) {
    const el = document.getElementById(focused) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) {
      el.focus({ preventScroll: true });
      if (selection && "setSelectionRange" in el) {
        try {
          el.setSelectionRange(selection[0], selection[1]);
        } catch {
          // Not every input type allows it.
        }
      }
    }
  }
  if (state.open) markSeen();
}

function autosize(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}

function wireComposer(el: HTMLTextAreaElement): void {
  el.addEventListener("input", () => {
    state.draft = el.value;
    autosize(el);
  });
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  });
}

/// --- mounting -------------------------------------------------------------------------

/**
 * Put the panel on the page. The relays are reached once the page has had a
 * moment to paint; opening the panel does not wait for that moment.
 */
export function mountChat(provide: () => ChatHost): void {
  host = provide;
  render();
  // On the document rather than the panel: a click that re-renders takes the
  // focus with the element it was on, and Escape should still mean "back".
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !state.open) return;
    if (state.sheet !== "none") setState({ sheet: "none" });
    else if (state.remoteUri) cancelRemote();
    else toggle();
  });
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(() => void load(), { timeout: 2500 });
  else window.setTimeout(() => void load(), 1200);
  // Nothing to tear down on unload: the browser drops the sockets itself, and
  // sending CLOSE frames into that only logs errors.
}

/** The page's state changed -- the wallet, the proposals. Reflect it. */
export function syncChat(): void {
  if (host && state.open) render();
}
