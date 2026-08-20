// The discussion, underneath: Nostr.
//
// A reader never has to know that. What they see is a chat that works the
// moment the page opens; what makes that possible is a key generated in the
// browser, messages signed with it and handed to a few public relays, and
// another reader's browser picking them up from the same relays. No account,
// no server of ours, nothing to sign up for. A reader who already has a key --
// in a browser extension, in Amber, behind a bunker -- can use that instead,
// and the chat follows them across devices.
//
// Two rooms:
//
//   public    kind 42 messages, readable by anyone, rooted at an id derived
//             from the network name so every copy of this page finds the same
//             room.
//   members   kind 4242, encrypted. The text is sealed with a fresh random key
//             and that key is wrapped, NIP-44, to every verified member the
//             sender knew of. The relays see who was addressed and nothing
//             else. A member who joins later cannot read what was sent before
//             they were verified -- the right property, and also the only one
//             a scheme without a server can have.
//
// Who is a member is decided by the pool, not by us. A chat key is tied to a
// Stacks address by one message the wallet signs, published as NIP-78
// application data, and every reader checks the signature and asks the pool
// whether that address holds a position. `stacks-verify.ts` does the checking
// without stacks.js, because most readers never load that.
//
// Loaded on demand from `chat.ts`: nostr-tools and the curve library are a
// chunk of their own, so the page still paints at the size it did.
import { SimplePool, type SubCloser } from "nostr-tools/pool";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type Event,
  type EventTemplate,
  type VerifiedEvent,
} from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import * as nip44 from "nostr-tools/nip44";
import {
  BunkerSigner,
  createNostrConnectURI,
  parseBunkerInput,
  toBunkerURL,
} from "nostr-tools/nip46";
import { normalizeURL } from "nostr-tools/utils";
import { sha256 } from "@noble/hashes/sha2.js";
import { apiBase, config, configured, type NetworkName } from "./config.js";
import {
  bytesToHex,
  decodeClarity,
  hexToBytes,
  principalHex,
  verifyAddressSignature,
  type Lite,
} from "./stacks-verify.js";

/// --- what the chat is made of ------------------------------------------------------

export type Room = "public" | "members";

export interface ChatMessage {
  id: string;
  pubkey: string;
  /** Unix seconds, as the sender claimed. */
  at: number;
  text: string;
  /** The proposal it is about, if it was sent from one. */
  proposal: number | null;
  room: Room;
}

/** A chat key that a Stacks address has vouched for. */
export interface Binding {
  pubkey: string;
  address: string;
  at: number;
}

export type SignerKind = "local" | "extension" | "remote";

export interface Identity {
  kind: SignerKind;
  pubkey: string;
  npub: string;
  /** Whether this signer can seal and open members-room messages. */
  canEncrypt: boolean;
}

export interface Status {
  /** Relays currently connected, out of those configured. */
  relays: number;
  total: number;
  /** The first load of each room has finished. */
  synced: boolean;
}

export interface Handlers {
  onMessage(message: ChatMessage): void;
  onProfile(pubkey: string, name: string): void;
  /** `member` is null while the pool could not be asked. */
  onBinding(binding: Binding, member: boolean | null): void;
  onStatus(status: Status): void;
  onIdentity(identity: Identity): void;
}

/// --- constants ------------------------------------------------------------------

/** Where messages go. `?relays=wss://a,wss://b` overrides for a test. */
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
];

const KIND_PROFILE = 0;
const KIND_PUBLIC = 42; // NIP-28 channel message
const KIND_MEMBERS = 4242; // ours: a sealed room message
const KIND_BINDING = 30078; // NIP-78 application-specific data

const STORE_IDENTITY = "esbee:chat:identity";
const HISTORY = 200;
/** How long an answer from the pool about an address is good for. */
const MEMBERSHIP_TTL = 10 * 60 * 1000;

/// --- the rooms -------------------------------------------------------------------

/**
 * A room is named by a 32-byte id, like a NIP-28 channel. Derived rather than
 * created, so every copy of this page on a network lands in the same room
 * without anything having been published first.
 */
const roomId = (room: Room, network: NetworkName): string =>
  bytesToHex(sha256(new TextEncoder().encode(`esbee-dao:chat:${room}:${network}`)));

const bindingTag = (network: NetworkName): string => `esbee-dao:member:${network}`;

/**
 * The text a wallet signs to vouch for a chat key. Plain words, because the
 * wallet shows it to the member and they should be able to read what they are
 * agreeing to. Every reader rebuilds it from the event and checks the
 * signature against it.
 */
export function bindingMessage(npub: string, address: string, network: NetworkName): string {
  return [
    "Esbee DAO — member chat",
    "",
    "I hold this Stacks address and I am linking it to my chat identity.",
    "",
    `address: ${address}`,
    `chat key: ${npub}`,
    `network: ${network}`,
  ].join("\n");
}

/// --- signers ---------------------------------------------------------------------

interface Signer {
  kind: SignerKind;
  pubkey: string;
  canEncrypt: boolean;
  sign(template: EventTemplate): Promise<VerifiedEvent>;
  encrypt(peer: string, text: string): Promise<string>;
  decrypt(peer: string, payload: string): Promise<string>;
  close(): void;
}

type Stored =
  | { kind: "local"; secret: string }
  | { kind: "extension" }
  | { kind: "remote"; bunker: string; client: string };

/** NIP-07: what a browser extension puts on `window`. */
interface WindowNostr {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

const extension = (): WindowNostr | undefined =>
  (window as unknown as { nostr?: WindowNostr }).nostr;

export const hasExtension = (): boolean => Boolean(extension());

function localSigner(secret: Uint8Array): Signer {
  const pubkey = getPublicKey(secret);
  return {
    kind: "local",
    pubkey,
    canEncrypt: true,
    sign: async (template) => finalizeEvent(template, secret),
    encrypt: async (peer, text) => nip44.encrypt(text, nip44.getConversationKey(secret, peer)),
    decrypt: async (peer, payload) => nip44.decrypt(payload, nip44.getConversationKey(secret, peer)),
    close: () => {},
  };
}

async function extensionSigner(): Promise<Signer> {
  const ext = extension();
  if (!ext) throw new Error("No browser extension found");
  const pubkey = await ext.getPublicKey();
  return {
    kind: "extension",
    pubkey,
    canEncrypt: Boolean(ext.nip44),
    sign: (template) => ext.signEvent(template),
    encrypt: (peer, text) => {
      if (!ext.nip44) throw new Error("This extension cannot encrypt");
      return ext.nip44.encrypt(peer, text);
    },
    decrypt: (peer, payload) => {
      if (!ext.nip44) throw new Error("This extension cannot decrypt");
      return ext.nip44.decrypt(peer, payload);
    },
    close: () => {},
  };
}

function remoteSigner(bunker: BunkerSigner, pubkey: string): Signer {
  return {
    kind: "remote",
    pubkey,
    canEncrypt: true,
    sign: (template) => bunker.signEvent(template),
    encrypt: (peer, text) => bunker.nip44Encrypt(peer, text),
    decrypt: (peer, payload) => bunker.nip44Decrypt(peer, payload),
    close: () => void bunker.close().catch(() => {}),
  };
}

/// --- membership ---------------------------------------------------------------------

const membership = new Map<string, { member: boolean; at: number }>();

/**
 * Whether an address holds a position in the pool: committed shares, which is
 * what carries a vote, or a deposit queued for the next roll. Null when there
 * is no deployment to ask, or it did not answer.
 */
export async function isMember(address: string): Promise<boolean | null> {
  if (!configured()) return null;
  const known = membership.get(address);
  if (known && Date.now() - known.at < MEMBERSHIP_TTL) return known.member;
  const arg = principalHex(address);
  if (!arg) return false;
  try {
    const response = await fetch(
      `${apiBase()}/v2/contracts/call-read/${config.deployer}/${config.pool}/get-settled-member`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: config.deployer, arguments: [arg] }),
      },
    );
    const json = (await response.json()) as { okay: boolean; result?: string };
    if (!json.okay || !json.result) return null;
    const record = decodeClarity(json.result) as Record<string, Lite> | null;
    const positive = (key: string): boolean => {
      const v = record?.[key];
      return typeof v === "bigint" && v > 0n;
    };
    const member =
      record !== null &&
      (positive("shares") || positive("bonded-sats") || positive("queued-sats"));
    membership.set(address, { member, at: Date.now() });
    return member;
  } catch {
    return null;
  }
}

/** A Stacks address is on one network, and the page is on one. */
const addressOnNetwork = (address: string, network: NetworkName): boolean =>
  /^S[PM]/.test(address) === (network === "mainnet");

/// --- the backend ------------------------------------------------------------------

export class ChatBackend {
  private pool = new SimplePool();
  private relays: string[];
  private network: NetworkName;
  private handlers: Handlers;
  private signer: Signer | null = null;
  private subs: SubCloser[] = [];
  private seen = new Set<string>();
  private profiled = new Set<string>();
  private profileSub: SubCloser | null = null;
  private profileTimer: ReturnType<typeof setTimeout> | null = null;
  private synced = { public: false, members: false };
  /** Sealed messages kept until a signer that can open them is available. */
  private sealed = new Map<string, Event>();
  private bindings = new Map<string, Binding>();

  constructor(network: NetworkName, handlers: Handlers) {
    this.network = network;
    this.handlers = handlers;
    const override = new URLSearchParams(location.search).get("relays");
    // Normalised the way the pool keys them, so a status lookup finds them.
    this.relays = (
      override
        ? override.split(",").map((r) => r.trim()).filter((r) => /^wss?:\/\//.test(r))
        : DEFAULT_RELAYS
    ).map(normalizeURL);
  }

  /// --- identity ---

  identity(): Identity | null {
    const s = this.signer;
    return s
      ? { kind: s.kind, pubkey: s.pubkey, npub: nip19.npubEncode(s.pubkey), canEncrypt: s.canEncrypt }
      : null;
  }

  /**
   * Restore whatever identity this browser used last, or make one.
   *
   * A remote signer that does not answer falls back to a fresh local key
   * rather than a chat that cannot speak; the stored pointer is kept, so the
   * next visit tries again.
   */
  async restoreIdentity(): Promise<Identity> {
    const stored = readStored();
    try {
      if (stored?.kind === "extension" && extension()) {
        return this.adopt(await extensionSigner(), stored);
      }
      if (stored?.kind === "remote") {
        const bp = await parseBunkerInput(stored.bunker);
        if (bp) {
          const bunker = BunkerSigner.fromBunker(hexToBytes(stored.client), bp, { pool: this.pool });
          await withTimeout(bunker.connect(), 15_000);
          const pubkey = await withTimeout(bunker.getPublicKey(), 15_000);
          return this.adopt(remoteSigner(bunker, pubkey), stored);
        }
      }
      if (stored?.kind === "local") {
        return this.adopt(localSigner(hexToBytes(stored.secret)), stored);
      }
    } catch {
      // Fall through to a key that always works.
    }
    const secret = generateSecretKey();
    return this.adopt(localSigner(secret), { kind: "local", secret: bytesToHex(secret) }, !stored);
  }

  private adopt(signer: Signer, stored: Stored, persist = true): Identity {
    this.signer?.close();
    this.signer = signer;
    if (persist) localStorage.setItem(STORE_IDENTITY, JSON.stringify(stored));
    const identity = this.identity()!;
    this.handlers.onIdentity(identity);
    // A brought key may have a name already; a generated one will have none,
    // which costs one subscription to learn.
    this.wantProfile(signer.pubkey);
    // Whatever was sealed to the previous key is no business of this one;
    // whatever is sealed to this one can now be opened.
    void this.openSealed();
    return identity;
  }

  /** A fresh key, generated here. */
  newLocalKey(): Identity {
    const secret = generateSecretKey();
    return this.adopt(localSigner(secret), { kind: "local", secret: bytesToHex(secret) });
  }

  /** A key the reader brought: `nsec1…` or 64 hex characters. */
  useSecret(input: string): Identity {
    const text = input.trim();
    let secret: Uint8Array;
    if (text.startsWith("nsec1")) {
      const decoded = nip19.decode(text);
      if (decoded.type !== "nsec") throw new Error("That is not a secret key");
      secret = decoded.data;
    } else if (/^[0-9a-f]{64}$/i.test(text)) {
      secret = hexToBytes(text);
    } else {
      throw new Error("A secret key is nsec1… or 64 hex characters");
    }
    return this.adopt(localSigner(secret), { kind: "local", secret: bytesToHex(secret) });
  }

  async useExtension(): Promise<Identity> {
    return this.adopt(await extensionSigner(), { kind: "extension" });
  }

  /** A remote signer the reader already has a `bunker://` URL for. */
  async useBunker(url: string): Promise<Identity> {
    const bp = await parseBunkerInput(url.trim());
    if (!bp) throw new Error("That is not a bunker:// URL");
    const client = generateSecretKey();
    const bunker = BunkerSigner.fromBunker(client, bp, { pool: this.pool });
    await withTimeout(bunker.connect(), 60_000);
    const pubkey = await withTimeout(bunker.getPublicKey(), 30_000);
    return this.adopt(remoteSigner(bunker, pubkey), {
      kind: "remote",
      bunker: toBunkerURL(bunker.bp),
      client: bytesToHex(client),
    });
  }

  /**
   * The other way round: this page offers a `nostrconnect://` link, and the
   * signer -- Amber on a phone, nsec.app in a tab -- opens it and calls back
   * over the relays. `done` resolves once it has.
   */
  connectRemote(abort: AbortSignal): { uri: string; done: Promise<Identity> } {
    const client = generateSecretKey();
    const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const uri = createNostrConnectURI({
      clientPubkey: getPublicKey(client),
      relays: this.relays.slice(0, 2),
      secret,
      perms: [
        "get_public_key",
        `sign_event:${KIND_PUBLIC}`,
        `sign_event:${KIND_MEMBERS}`,
        `sign_event:${KIND_PROFILE}`,
        `sign_event:${KIND_BINDING}`,
        "nip44_encrypt",
        "nip44_decrypt",
      ],
      name: "Esbee DAO",
      url: location.origin,
    });
    const done = BunkerSigner.fromURI(client, uri, { pool: this.pool }, abort).then(
      async (bunker) => {
        const pubkey = await withTimeout(bunker.getPublicKey(), 30_000);
        return this.adopt(remoteSigner(bunker, pubkey), {
          kind: "remote",
          bunker: toBunkerURL(bunker.bp),
          client: bytesToHex(client),
        });
      },
    );
    return { uri, done };
  }

  /** The local key as `nsec1…`, for backing up. Null for a key held elsewhere. */
  exportSecret(): string | null {
    const stored = readStored();
    return stored?.kind === "local" && this.signer?.kind === "local"
      ? nip19.nsecEncode(hexToBytes(stored.secret))
      : null;
  }

  /// --- reading ---

  start(): void {
    this.stop();
    const onStatus = () => this.reportStatus();
    const common = {
      onclose: onStatus,
      maxWait: 8000,
    };
    this.subs.push(
      this.pool.subscribe(
        this.relays,
        { kinds: [KIND_PUBLIC], "#e": [roomId("public", this.network)], limit: HISTORY },
        {
          ...common,
          onevent: (event) => this.onPublic(event),
          oneose: () => {
            this.synced.public = true;
            this.reportStatus();
          },
        },
      ),
      this.pool.subscribe(
        this.relays,
        { kinds: [KIND_MEMBERS], "#e": [roomId("members", this.network)], limit: HISTORY },
        {
          ...common,
          onevent: (event) => void this.onMembers(event),
          oneose: () => {
            this.synced.members = true;
            this.reportStatus();
          },
        },
      ),
      this.pool.subscribe(
        this.relays,
        { kinds: [KIND_BINDING], "#d": [bindingTag(this.network)] },
        { ...common, onevent: (event) => void this.onBindingEvent(event) },
      ),
    );
    // Connection counts change without an event to hang them off.
    window.setTimeout(onStatus, 1500);
    window.setTimeout(onStatus, 5000);
  }

  stop(): void {
    for (const sub of this.subs) sub.close();
    this.subs = [];
    this.profileSub?.close();
    this.profileSub = null;
  }

  private reportStatus(): void {
    let up = 0;
    for (const [url, ok] of this.pool.listConnectionStatus()) {
      if (ok && this.relays.includes(url)) up++;
    }
    this.handlers.onStatus({
      relays: up,
      total: this.relays.length,
      synced: this.synced.public && this.synced.members,
    });
  }

  private onPublic(event: Event): void {
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    const text = event.content.trim();
    if (!text) return;
    this.handlers.onMessage({
      id: event.id,
      pubkey: event.pubkey,
      at: event.created_at,
      text: text.slice(0, 2000),
      proposal: proposalTag(event),
      room: "public",
    });
    this.wantProfile(event.pubkey);
  }

  private async onMembers(event: Event): Promise<void> {
    if (this.seen.has(event.id)) return;
    // Kept until it can be opened -- the signer may not be restored yet, or
    // may be one this was not sealed to.
    this.sealed.set(event.id, event);
    await this.tryOpen(event);
  }

  private async openSealed(): Promise<void> {
    for (const event of [...this.sealed.values()]) await this.tryOpen(event);
  }

  private async tryOpen(event: Event): Promise<void> {
    const signer = this.signer;
    if (!signer || !signer.canEncrypt) return;
    const wrap = event.tags.find((t) => t[0] === "wrap" && t[1] === signer.pubkey)?.[2];
    if (!wrap) return;
    try {
      const key = hexToBytes(await signer.decrypt(event.pubkey, wrap));
      const body = JSON.parse(nip44.decrypt(event.content, key)) as {
        text?: string;
        proposal?: number | null;
      };
      const text = String(body.text ?? "").trim();
      this.seen.add(event.id);
      this.sealed.delete(event.id);
      if (!text) return;
      this.handlers.onMessage({
        id: event.id,
        pubkey: event.pubkey,
        at: event.created_at,
        text: text.slice(0, 2000),
        proposal: typeof body.proposal === "number" ? body.proposal : null,
        room: "members",
      });
      this.wantProfile(event.pubkey);
    } catch {
      // Not for this key after all, or a signer that declined. Left sealed.
    }
  }

  private async onBindingEvent(event: Event): Promise<void> {
    const previous = this.bindings.get(event.pubkey);
    if (previous && previous.at >= event.created_at) return;
    const binding = verifyBinding(event, this.network);
    if (!binding) return;
    this.bindings.set(event.pubkey, binding);
    this.handlers.onBinding(binding, await isMember(binding.address));
    this.wantProfile(event.pubkey);
  }

  /** Ask the pool again about everyone it has vouched for, after the TTL. */
  async recheckMembers(): Promise<void> {
    for (const binding of this.bindings.values()) {
      this.handlers.onBinding(binding, await isMember(binding.address));
    }
  }

  private wantProfile(pubkey: string): void {
    if (this.profiled.has(pubkey)) return;
    this.profiled.add(pubkey);
    if (this.profileTimer) clearTimeout(this.profileTimer);
    this.profileTimer = setTimeout(() => this.watchProfiles(), 400);
  }

  /**
   * Names, for everyone seen so far. One live subscription over the whole set,
   * reopened as it grows: a name set after someone has already been seen would
   * otherwise not reach anyone until they reloaded.
   */
  private watchProfiles(): void {
    const authors = [...this.profiled];
    if (!authors.length) return;
    this.profileSub?.close();
    const latest = new Map<string, number>();
    this.profileSub = this.pool.subscribe(
      this.relays,
      { kinds: [KIND_PROFILE], authors },
      {
        onevent: (event) => {
          if ((latest.get(event.pubkey) ?? 0) >= event.created_at) return;
          latest.set(event.pubkey, event.created_at);
          try {
            const meta = JSON.parse(event.content) as { name?: string; display_name?: string };
            const name = String(meta.display_name || meta.name || "").trim();
            if (name) this.handlers.onProfile(event.pubkey, name.slice(0, 40));
          } catch {
            // A profile that is not JSON says nothing.
          }
        },
      },
    );
  }

  /// --- writing ---

  private async publish(template: EventTemplate): Promise<Event> {
    const signer = this.signer;
    if (!signer) throw new Error("No chat identity yet");
    const event = await signer.sign(template);
    const results = await Promise.allSettled(this.pool.publish(this.relays, event));
    if (!results.some((r) => r.status === "fulfilled")) {
      const why = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      throw new Error(`No relay accepted it${why ? `: ${String(why.reason)}` : ""}`);
    }
    return event;
  }

  /**
   * Say something in a room.
   *
   * In the members room `recipients` is every verified member this client
   * knows of, the sender included: the text is sealed under a random key and
   * that key wrapped to each of them. The relays learn who was addressed and
   * how long it was, and no more.
   */
  async send(room: Room, text: string, proposal: number | null, recipients: string[]): Promise<ChatMessage> {
    const signer = this.signer;
    if (!signer) throw new Error("No chat identity yet");
    const body = text.trim().slice(0, 2000);
    if (!body) throw new Error("Nothing to send");
    const root = ["e", roomId(room, this.network), this.relays[0] ?? "", "root"];

    let event: Event;
    if (room === "public") {
      event = await this.publish({
        kind: KIND_PUBLIC,
        created_at: now(),
        tags: [root, ...(proposal !== null ? [["proposal", String(proposal)]] : [])],
        content: body,
      });
    } else {
      if (!signer.canEncrypt) throw new Error("This identity cannot encrypt");
      const to = [...new Set([signer.pubkey, ...recipients])];
      const key = crypto.getRandomValues(new Uint8Array(32));
      const wraps = await Promise.all(
        to.map(async (pub) => ["wrap", pub, await signer.encrypt(pub, bytesToHex(key))]),
      );
      event = await this.publish({
        kind: KIND_MEMBERS,
        created_at: now(),
        tags: [root, ...to.map((pub) => ["p", pub]), ...wraps],
        content: nip44.encrypt(JSON.stringify({ text: body, proposal }), key),
      });
    }
    this.seen.add(event.id);
    return { id: event.id, pubkey: event.pubkey, at: event.created_at, text: body, proposal, room };
  }

  /** A display name, for a key this page generated. Others keep their own profile. */
  async setName(name: string): Promise<void> {
    await this.publish({
      kind: KIND_PROFILE,
      created_at: now(),
      tags: [],
      content: JSON.stringify({ name: name.trim().slice(0, 40), about: "Esbee DAO member chat" }),
    });
  }

  /** The text the wallet is asked to sign for the current identity. */
  bindingText(address: string): string {
    const me = this.identity();
    if (!me) throw new Error("No chat identity yet");
    return bindingMessage(me.npub, address, this.network);
  }

  /**
   * Publish the wallet's vouching for this key. Checked here first, so a
   * wallet that signed something else is caught before anything is sent.
   */
  async publishBinding(address: string, signature: string, publicKey: string): Promise<Binding> {
    const me = this.identity();
    if (!me) throw new Error("No chat identity yet");
    const message = bindingMessage(me.npub, address, this.network);
    if (!verifyAddressSignature(message, signature, address, publicKey)) {
      throw new Error("The wallet's signature does not match that address");
    }
    const event = await this.publish({
      kind: KIND_BINDING,
      created_at: now(),
      tags: [
        ["d", bindingTag(this.network)],
        ["t", "esbee-dao"],
      ],
      content: JSON.stringify({ v: 1, address, signature, publicKey, network: this.network }),
    });
    const binding = { pubkey: me.pubkey, address, at: event.created_at };
    this.bindings.set(me.pubkey, binding);
    return binding;
  }

  destroy(): void {
    this.stop();
    this.signer?.close();
    this.pool.destroy();
  }
}

/// --- helpers ---------------------------------------------------------------------

const now = (): number => Math.floor(Date.now() / 1000);

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORE_IDENTITY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function proposalTag(event: Event): number | null {
  const tag = event.tags.find((t) => t[0] === "proposal")?.[1];
  const id = tag ? Number(tag) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Check one binding event: the signature, the address's network, the key named. */
export function verifyBinding(event: Event, network: NetworkName): Binding | null {
  try {
    const body = JSON.parse(event.content) as {
      address?: string;
      signature?: string;
      publicKey?: string;
      network?: string;
    };
    const address = String(body.address ?? "").toUpperCase();
    if (!address || body.network !== network || !addressOnNetwork(address, network)) return null;
    const message = bindingMessage(nip19.npubEncode(event.pubkey), address, network);
    if (!verifyAddressSignature(message, String(body.signature ?? ""), address, body.publicKey)) {
      return null;
    }
    return { pubkey: event.pubkey, address, at: event.created_at };
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The signer did not answer in time")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
