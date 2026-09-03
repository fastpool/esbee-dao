// The analytics page: this code, wherever it is deployed, measured.
//
// Three things it is trying to be, in the order it puts them:
//
//   a comparison   -- more than one set of these contracts exists. `vault-1`
//                     and `vault-2` are the same pool and the same DAO deployed
//                     twice at one address, holding different money, and there
//                     is no reason a third could not be somebody else's. So the
//                     page reads a *list* of deployments and puts them side by
//                     side before it says anything about any one of them.
//
//   a work list    -- several calls here are permissionless: the mandate is the
//                     state on chain, not the caller. A swept deposit nobody
//                     credited, a lapsed address holding somebody's STX, a
//                     proposal that carried and was never spent. A call nobody
//                     is watching for is a call nobody makes, so they are
//                     listed, across every deployment, with the button.
//
//   a ledger       -- and then the numbers, for one deployment at a time: the
//                     balance sheet, what the next roll would commit, every
//                     epoch it has rolled through, what its members have done,
//                     how the bridge's funnel converts, and how its floor votes.
//
// Two rules run through all of it. **Nothing is derived.** Every figure is a
// variable the contract keeps or a count of events it printed; there is no APY
// here, no annualisation and no average that the chain does not itself hold.
// And **nothing is assumed about a deployment**: each is asked what functions
// it answers to before it is read, because "the same code" is never quite the
// same code -- the two bridges on testnet already differ -- and a section that
// cannot be read is left out rather than shown broken.
import { mountInto, type Scope } from "./render.js";
import {
  SWITCHABLE,
  blockMinutes,
  bitcoin,
  config,
  configured,
  deployments,
  explorerBtcTx,
  explorerContract,
  explorerTx,
  hasDeployment,
  net,
  setNetwork,
  type Deployment,
} from "./config.js";
import type {
  BridgeLogEntry,
  Capabilities,
  Epoch,
  Floor,
  FloorEntry,
  PoolExtras,
  PoolLogEntry,
  PoolState,
  PoxAddress,
  Site,
} from "./chain.js";
import type { Plain } from "./plain.js";
import { freezeIn } from "./cycles.js";

type ChainModule = typeof import("./chain.js");
type L1Module = typeof import("./l1.js");

let chain: ChainModule | null = null;
const chainApi = async (): Promise<ChainModule> =>
  (chain ??= await import("./chain.js"));

let l1: L1Module | null = null;
const l1Api = async (): Promise<L1Module> => (l1 ??= await import("./l1.js"));

/// --- what the page knows ---------------------------------------------------------

/** One output of one transaction that left an announced address. */
interface Candidate {
  txid: string;
  vout: number;
  /** What the output paid, on bitcoin. What is credited is what was swept. */
  sats: number;
  /** Where it went -- the derived sBTC deposit address, if this is a deposit. */
  to: string;
  height: number | null;
  /** Every input locked to the announced address, which the bridge insists on. */
  clean: boolean;
  /** What the sBTC registry says, once it has been asked. */
  swept: { sats: number; recipient: string; at: number } | null;
  credited: boolean;
  /** Whether `complete-btc-deposit` would take it now, and why not otherwise. */
  ready: boolean;
  why: string;
}

/** An announcement the bridge is still holding: a deposit nobody has finished. */
interface Waiting {
  key: string;
  member: string;
  script: string;
  address: PoxAddress;
  /** The funding address spelled out, or "" where this chain cannot spell it. */
  text: string;
  sats: number;
  ustx: number;
  announcedAt: number;
  /** The burn height from which anyone may cancel it and refund the STX leg. */
  lapsesAt: number;
  /** The Stacks transaction that revealed it. */
  tx: string;
  /** What bitcoin says came out of that address. Null until it has been read. */
  candidates: Candidate[] | null;
  /** Why the bitcoin side could not be read, where it could not. */
  blind: string;
}

/** A commitment the bridge is still holding: a route that stopped at step 1. */
interface Holding {
  key: string;
  member: string;
  digest: string;
  sats: number;
  ustx: number;
  committedAt: number;
  lapsesAt: number;
  tx: string;
}

/** Everything the page has read about one deployment. */
interface Reading {
  site: Site;
  can: Capabilities | null;
  pool: PoolState | null;
  extras: PoolExtras | null;
  floor: Floor | null;
  epochs: Epoch[];
  checks: { name: string; holds: boolean | null }[];
  bridge: BridgeLogEntry[] | null;
  activity: PoolLogEntry[] | null;
  waiting: Waiting[];
  holding: Holding[];
  /** The principal an sBTC deposit has to credit for this bridge to take it. */
  treasury: string;
  /** Whether this bridge speaks the protocol the work list needs. */
  keepable: boolean;
  failed: string;
}

interface State {
  account: string | null;
  connected: boolean;
  notice: string;
  /** Where the burn chain is, which every deadline on this page is read against. */
  burn: number;
  sites: Site[];
  readings: Reading[];
  /** Which deployment the detail below the comparison is about. */
  focus: string;
  reading: boolean;
  failed: string;
}

/** A deployment's identity: four contracts, so all four have to match. */
const idOf = (site: Deployment): string =>
  `${site.deployer}.${site.dao}.${site.pool}.${site.bridge}`;

const state: State = {
  account: null,
  connected: false,
  notice: "",
  burn: 0,
  sites: [],
  readings: [],
  focus: "",
  reading: true,
  failed: "",
};

function setState(patch: Partial<State>): void {
  Object.assign(state, patch);
  render();
}

/** The reading the detail sections are about. */
const focused = (): Reading | null =>
  state.readings.find((r) => idOf(r.site) === state.focus) ?? state.readings[0] ?? null;

/// --- saying numbers --------------------------------------------------------------

const SATS_PER_BTC = 100_000_000;

const fmt = (n: number): string => Number(n).toLocaleString("en-US");
const shorten = (a: string): string =>
  a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
const middle = (value: string, head = 12, tail = 8): string =>
  value.length > head + tail + 1
    ? `${value.slice(0, head)}…${value.slice(-tail)}`
    : value;

/** Both units, because neither alone is readable: one has zeros, one has none. */
const written = (sats: number): string =>
  `${btc(sats)} BTC · ${fmt(sats)} sats`;

const btc = (sats: number): string =>
  (sats / SATS_PER_BTC).toFixed(8).replace(/\.?0+$/, "") || "0";

const stx = (ustx: number): string => `${(ustx / 1e6).toFixed(2)} STX`;

/** A share of something, or "—" where the denominator is zero rather than 0%. */
const share = (part: number, whole: number): string =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";

const plural = (n: number, unit: string): string =>
  `${n} ${unit}${n === 1 ? "" : "s"}`;

/** A span of burn blocks at this chain's own pace, spelled out. */
function duration(blocks: number): string {
  const hours = Math.round((Math.abs(blocks) * blockMinutes()) / 60);
  if (hours < 1) return "under an hour";
  if (hours < 48) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? plural(days, "day") : `${plural(days, "day")} ${plural(rest, "hour")}`;
}

/** "in 3 hours" / "2 days ago" -- signed, for deadlines that run both ways. */
function relative(target: number, now: number): string {
  if (!now || !target) return "";
  const blocks = target - now;
  if (blocks === 0) return "now";
  return blocks > 0 ? `in ${duration(blocks)}` : `${duration(blocks)} ago`;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A decoded tuple, or null for the `none` a map-get returns. */
const tuple = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const number = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const field = (totals: Record<string, Plain> | null | undefined, key: string): number =>
  totals ? number(totals[key]) : 0;

/// --- reading it all back ----------------------------------------------------------

/** How far back each contract's log is walked. Four pages of Hiro's fifty. */
const LOG_DEPTH = 200;

/**
 * How many announcements get the bitcoin treatment, across every deployment.
 *
 * Scanning one costs an address lookup on a public explorer plus two read-only
 * calls per candidate output, on behalf of a reader who asked for none of them.
 * The answer that matters -- what is waiting *now* -- is at the top of the
 * list; the rest are still listed and say they were not scanned rather than
 * reading as "no deposit found".
 */
const SCAN_DEPTH = 8;

/** The bridge's own two deadlines, in burn blocks. */
const ANNOUNCE_TTL = 1000;
const COMMIT_TTL = 36;

async function refresh(): Promise<void> {
  const sites = deployments();
  if (sites.length === 0) {
    return setState({
      sites: [],
      readings: [],
      reading: false,
      failed:
        "This page has no deployment configured for this network, so there is " +
        "nothing to read. Switch to a network that has one, or name one with " +
        "?deployments=.",
    });
  }
  setState({
    sites,
    reading: true,
    failed: "",
    focus: state.focus || idOf(sites[0]!),
    readings: sites.map((site) => blank(site)),
  });
  const api = await chainApi();
  setState({ burn: await api.burnHeight().catch(() => 0) });
  // Every deployment at once: they are separate contracts and nothing about one
  // read depends on another's answer.
  await Promise.all(sites.map((site) => read(api, site)));
  setState({ reading: false });
  void scan();
}

const blank = (site: Site): Reading => ({
  site,
  can: null,
  pool: null,
  extras: null,
  floor: null,
  epochs: [],
  checks: [],
  bridge: null,
  activity: null,
  waiting: [],
  holding: [],
  treasury: "",
  keepable: false,
  failed: "",
});

/** Replace one deployment's reading in place, leaving the others alone. */
function update(site: Site, patch: Partial<Reading>): void {
  setState({
    readings: state.readings.map((entry) =>
      idOf(entry.site) === idOf(site) ? { ...entry, ...patch } : entry,
    ),
  });
}

/**
 * One deployment, read through.
 *
 * Capabilities first, and everything after it is gated on them: this is what
 * lets an older deployment sit in the same list as a newer one and report what
 * it has rather than erroring on what it has not.
 */
async function read(api: ChainModule, site: Site): Promise<void> {
  try {
    const can = await api.capabilities(site);
    // `get-announcement-by-script` is what a work list is built out of -- a
    // bridge without it stores announcements this page has no way to enumerate.
    const keepable = can.bridge.has("get-announcement-by-script");
    update(site, { can, keepable });

    const [pool, extras, floor, activity, bridgeLog, treasury] = await Promise.all([
      api.loadPool(site).catch(() => null),
      api.poolExtras(site, can.pool).catch(() => null),
      can.dao.has("get-proposal-count") ? api.loadFloor(site).catch(() => null) : null,
      api.poolLog(LOG_DEPTH, site).catch(() => null),
      api.bridgeLog(LOG_DEPTH, site).catch(() => null),
      keepable ? api.depositRecipient(site).catch(() => null) : null,
    ]);
    update(site, {
      pool,
      extras,
      floor,
      activity,
      bridge: bridgeLog,
      treasury: treasury ? String(treasury) : "",
    });

    const epochCount = field(pool?.config, "epoch-count");
    const [epochs, checks] = await Promise.all([
      api.epochHistory(epochCount, site).catch(() => []),
      api.invariants(site, can.pool).catch(() => []),
    ]);
    update(site, { epochs, checks });

    if (keepable && bridgeLog) {
      const [waiting, holding] = await Promise.all([
        liveAnnouncements(api, bridgeLog, site),
        liveCommitments(api, bridgeLog, site),
      ]);
      update(site, { waiting, holding });
    }
  } catch (error) {
    update(site, { failed: message(error) });
  }
}

/**
 * Every announcement this bridge is still holding, newest first.
 *
 * A reveal in the log is a candidate, not an answer: the bridge deletes the
 * announcement when the deposit is completed and when it is cancelled, and
 * neither of those prints against the reveal. So each script is asked about
 * directly, and only what comes back as a tuple is listed.
 */
async function liveAnnouncements(
  api: ChainModule,
  log: BridgeLogEntry[],
  site: Site,
): Promise<Waiting[]> {
  const seen = new Set<string>();
  const reveals = log.filter((entry) => {
    if (entry.topic !== "reveal-btc-address" || !entry.script || !entry.address) return false;
    if (seen.has(entry.script)) return false;
    seen.add(entry.script);
    return true;
  });
  const rows = await Promise.all(
    reveals.map(async (entry): Promise<Waiting | null> => {
      const held = tuple(
        await api.announcementByScript(entry.script, site).catch(() => null),
      );
      if (!held) return null;
      const announcedAt = number(held["announced-at-height"]);
      return {
        key: `${idOf(site)}:${entry.script}`,
        member: String(held["member"] ?? entry.member),
        script: entry.script,
        address: entry.address!,
        text: encoded(entry.address!),
        sats: number(held["sats"]),
        ustx: number(held["ustx"]),
        announcedAt,
        // Read from the height the map holds rather than from the event's own
        // `cancellable-from`: the announcement standing today may be a later
        // one for the same address, and the deadline belongs to that one.
        lapsesAt: announcedAt + ANNOUNCE_TTL,
        tx: entry.tx,
        candidates: null,
        blind: "",
      };
    }),
  );
  return rows
    .filter((row): row is Waiting => row !== null)
    .sort((a, b) => b.announcedAt - a.announcedAt);
}

/** The same, for commitments -- keyed by member and digest rather than script. */
async function liveCommitments(
  api: ChainModule,
  log: BridgeLogEntry[],
  site: Site,
): Promise<Holding[]> {
  const seen = new Set<string>();
  const commits = log.filter((entry) => {
    if (entry.topic !== "commit-btc-address" || !entry.digest) return false;
    const key = `${entry.member}:${entry.digest}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rows = await Promise.all(
    commits.map(async (entry): Promise<Holding | null> => {
      const held = tuple(
        await api.commitmentFor(entry.member, entry.digest, site).catch(() => null),
      );
      if (!held) return null;
      const committedAt = number(held["committed-at-height"]);
      return {
        key: `${idOf(site)}:${entry.member}:${entry.digest}`,
        member: entry.member,
        digest: entry.digest,
        sats: number(held["sats"]),
        ustx: number(held["ustx"]),
        committedAt,
        lapsesAt: committedAt + COMMIT_TTL,
        tx: entry.tx,
      };
    }),
  );
  return rows
    .filter((row): row is Holding => row !== null)
    .sort((a, b) => b.committedAt - a.committedAt);
}

/** The address as this chain spells it, or "" where it cannot be spelled here. */
let encoder: ((address: PoxAddress) => string) | null = null;
const encoded = (address: PoxAddress): string => {
  try {
    return encoder ? encoder(address) : "";
  } catch {
    return "";
  }
};

/** Every announcement standing anywhere, newest first, with its deployment. */
const allWaiting = (): { row: Waiting; reading: Reading }[] =>
  state.readings
    .flatMap((reading) => reading.waiting.map((row) => ({ row, reading })))
    .sort((a, b) => b.row.announcedAt - a.row.announcedAt);

const allHolding = (): { row: Holding; reading: Reading }[] =>
  state.readings
    .flatMap((reading) => reading.holding.map((row) => ({ row, reading })))
    .sort((a, b) => b.row.committedAt - a.row.committedAt);

/**
 * Look at bitcoin for the newest announcements, one at a time.
 *
 * One at a time and not in parallel: this is a public explorer being asked
 * about several addresses on behalf of a reader who asked for none of them, and
 * a page that fans out over it is a page that gets rate-limited. Each answer is
 * rendered as it lands, so the list fills in rather than waiting on the last.
 */
async function scan(): Promise<void> {
  const rows = allWaiting();
  if (rows.length === 0) return;
  const bitcoinApi = await l1Api().catch(() => null);
  if (!bitcoinApi) {
    // Every row would otherwise sit at "looking…" for good. Saying the bundle
    // did not load is not much, but it is not a spinner that never resolves.
    return markScanned(rows, "the bitcoin half of this page did not load");
  }
  encoder = bitcoinApi.encodeAddress;
  // Re-spell the addresses now that the encoder is here; they were read before
  // the bitcoin bundle had loaded.
  setState({
    readings: state.readings.map((reading) => ({
      ...reading,
      waiting: reading.waiting.map((row) => ({ ...row, text: encoded(row.address) })),
    })),
  });
  const api = await chainApi();

  for (const { row, reading } of rows.slice(0, SCAN_DEPTH)) {
    let candidates: Candidate[] = [];
    let blind = "";
    try {
      const address = encoded(row.address);
      if (!address) throw new Error("this page cannot spell that address on this chain");
      const txs = await bitcoinApi.fundingTxs(address);
      for (const tx of txs) {
        for (const out of tx.outputs) {
          // An sBTC deposit address is a taproot output, always: the recipient
          // is committed to in a script tree. Anything else that left this
          // address went somewhere that is not the pool.
          if (!out.taproot) continue;
          candidates.push({
            txid: tx.txid,
            vout: out.index,
            sats: out.sats,
            to: out.address,
            height: tx.height,
            clean: tx.fromAddressOnly,
            swept: null,
            credited: false,
            ready: false,
            why: "",
          });
        }
      }
      candidates = candidates.slice(0, 6);
      await Promise.all(
        candidates.map(async (candidate) => {
          const [swept, credited] = await Promise.all([
            api.sweptDeposit(candidate.txid, candidate.vout).catch(() => null),
            api.creditedDeposit(candidate.txid, candidate.vout, reading.site).catch(() => null),
          ]);
          const sweep = tuple(swept);
          candidate.swept = sweep
            ? {
                sats: number(sweep["amount"]),
                recipient: String(sweep["recipient"] ?? ""),
                at: number(sweep["sweep-burn-height"]),
              }
            : null;
          candidate.credited = tuple(credited) !== null;
          judge(candidate, row, reading);
        }),
      );
    } catch (error) {
      blind = message(error);
    }
    setState({
      readings: state.readings.map((entry) => ({
        ...entry,
        waiting: entry.waiting.map((held) =>
          held.key === row.key ? { ...held, candidates, blind } : held,
        ),
      })),
    });
  }
}

/** Mark every row as looked at, with the reason nothing could be looked at. */
function markScanned(rows: { row: Waiting }[], blind: string): void {
  const keys = new Set(rows.map(({ row }) => row.key));
  setState({
    readings: state.readings.map((entry) => ({
      ...entry,
      waiting: entry.waiting.map((row) =>
        keys.has(row.key) ? { ...row, candidates: [], blind } : row,
      ),
    })),
  });
}

/**
 * Whether `complete-btc-deposit` would take this output, in the contract's own
 * order of checks -- so that "ready" here means the call succeeds rather than
 * that it looks plausible.
 */
function judge(candidate: Candidate, row: Waiting, reading: Reading): void {
  if (candidate.credited) {
    candidate.why = "Already credited to the pool. Nothing left to do for it.";
    return;
  }
  if (!candidate.swept) {
    candidate.why =
      "The sBTC signers have not swept it yet, so there is nothing to credit. " +
      "Step 5 opens by itself the moment the registry has the sweep.";
    return;
  }
  if (reading.treasury && candidate.swept.recipient !== reading.treasury) {
    candidate.why =
      `Swept, but minted to ${shorten(candidate.swept.recipient)} rather than ` +
      `${reading.site.label}'s treasury. The bridge refuses a deposit it does ` +
      `not hold the sats for.`;
    return;
  }
  if (!candidate.clean) {
    candidate.why =
      "Some input of this transaction was locked to another address. The bridge " +
      "proves whose bitcoin it was from the inputs, and it refuses a mixed one.";
    return;
  }
  if (row.announcedAt >= candidate.swept.at) {
    candidate.why =
      `The sweep landed at burn height ${fmt(candidate.swept.at)}, before this ` +
      `announcement at ${fmt(row.announcedAt)}. Announcing first is the whole ` +
      `argument that the bitcoin is the announcer's, so the bridge refuses it.`;
    return;
  }
  candidate.ready = true;
  candidate.why =
    `Swept and uncredited: ${written(candidate.swept.sats)} is with the signers ` +
    `and ${reading.site.label} has not been told. Anyone may make this call, and ` +
    `the sats go to ${shorten(row.member)} either way.`;
}

/// --- the calls anyone may make -----------------------------------------------------

/**
 * Run a wallet call and report it.
 *
 * Every call this page offers moves nothing of the caller's -- that is what
 * makes them permissionless -- so the only thing at stake in pressing one is
 * the fee.
 */
async function withWallet(label: string, run: () => Promise<string | null>): Promise<void> {
  if (!state.connected) {
    await connect();
    if (!state.connected) return;
  }
  try {
    setState({ notice: `Confirm ${label} in your wallet…` });
    const txid = await run();
    setState({ notice: txid ? `${label} submitted — ${txid}` : `${label} submitted` });
    if (txid) window.open(explorerTx(txid), "_blank", "noopener");
    // Long enough for a block, then read the whole page back: what was just
    // finished should stop being listed as pending.
    setTimeout(() => void refresh(), 20_000);
  } catch (error) {
    setState({ notice: `${label} failed: ${message(error)}` });
  }
}

/** Step 5, made by somebody who is not the member. */
async function complete(row: Waiting, candidate: Candidate, site: Site): Promise<void> {
  try {
    setState({ notice: "Reading the deposit back from bitcoin…" });
    const bitcoinSide = await l1Api();
    const raw = await bitcoinSide.rawTx(candidate.txid);
    const parents = await bitcoinSide.parents(raw);
    const api = await chainApi();
    await withWallet("the credit", () =>
      api.bridgeCalls.complete(
        candidate.txid,
        candidate.vout,
        raw,
        parents,
        row.ustx,
        site,
      ),
    );
  } catch (error) {
    setState({ notice: `Could not complete it: ${message(error)}` });
  }
}

/** Clear a lapsed announcement, handing the STX leg back to whoever paid it. */
async function releaseAddress(row: Waiting, site: Site): Promise<void> {
  const api = await chainApi();
  await withWallet("the release", () => api.bridgeCalls.cancelDeposit(row.address, site));
}

/** The same, for a commitment nobody revealed. */
async function releaseCommitment(row: Holding, site: Site): Promise<void> {
  const api = await chainApi();
  await withWallet("the cancellation", () =>
    api.bridgeCalls.cancelCommitment(row.member, row.digest, site),
  );
}

/** Spend a mandate the vote already granted. */
async function execute(entry: FloorEntry, site: Site): Promise<void> {
  const api = await chainApi();
  const run = api.executorFor[entry.proposal.kind];
  if (!run) {
    return setState({
      notice:
        `A ${entry.proposal.kind} proposal takes both signer managers as trait ` +
        `references, so it cannot be executed from an id alone. It is the one ` +
        `call this page cannot make for you.`,
    });
  }
  await withWallet(`proposal #${entry.id}`, () => run(entry.id, site));
}

/** Bank reward sBTC that has arrived and not been split. */
async function syncRewards(site: Site): Promise<void> {
  const api = await chainApi();
  await withWallet("the reward sync", () => api.poolCalls.syncRewards(site));
}

/// --- the wallet -------------------------------------------------------------------

async function connect(): Promise<void> {
  try {
    const api = await chainApi();
    const account = await api.connect();
    setState({ account, connected: Boolean(account) });
  } catch (error) {
    setState({ notice: `Could not connect: ${message(error)}` });
  }
}

function toggleWallet(): void {
  if (!state.connected) return void connect();
  void chainApi().then((api) => {
    api.disconnect();
    setState({ account: null, connected: false });
  });
}

/// --- the measurements ---------------------------------------------------------------

/** Principal one deployment accounts for, in the four places it can sit. */
function principal(reading: Reading): {
  bonded: number;
  queued: number;
  released: number;
  withdrawing: number;
  total: number;
  ustx: number;
} {
  const totals = reading.pool?.totals ?? null;
  const bonded = field(totals, "bonded-sats");
  const queued = field(totals, "queued-sats");
  const released = field(totals, "released-sats");
  const withdrawing = field(totals, "withdrawing-sats");
  return {
    bonded,
    queued,
    released,
    withdrawing,
    total: bonded + queued + released + withdrawing,
    ustx:
      field(totals, "bonded-ustx") +
      field(totals, "queued-ustx") +
      field(totals, "released-ustx"),
  };
}

/** How many announcements and mandates this deployment is waiting on. */
function openWork(reading: Reading): { ready: number; lapsed: number; mandates: number } {
  const burn = state.burn;
  let ready = 0;
  let lapsed = 0;
  for (const row of reading.waiting) {
    if ((row.candidates ?? []).some((c) => c.ready)) ready++;
    else if (burn > 0 && burn >= row.lapsesAt) lapsed++;
  }
  for (const row of reading.holding) if (burn > 0 && burn >= row.lapsesAt) lapsed++;
  const mandates = (reading.floor?.proposals ?? []).filter((p) => p.status.ready).length;
  return { ready, lapsed, mandates };
}

/** Counts and volumes by topic, over whatever window the log reached. */
function tally<T extends { topic: string; sats?: number; ustx?: number }>(
  log: T[] | null,
): Map<string, { count: number; sats: number; ustx: number }> {
  const out = new Map<string, { count: number; sats: number; ustx: number }>();
  for (const entry of log ?? []) {
    const row = out.get(entry.topic) ?? { count: 0, sats: 0, ustx: 0 };
    row.count += 1;
    row.sats += entry.sats ?? 0;
    row.ustx += entry.ustx ?? 0;
    out.set(entry.topic, row);
  }
  return out;
}

const counted = (
  from: Map<string, { count: number; sats: number; ustx: number }>,
  topic: string,
): { count: number; sats: number; ustx: number } =>
  from.get(topic) ?? { count: 0, sats: 0, ustx: 0 };

/// --- the view model ----------------------------------------------------------------

/** How the pool says what it is doing, in the topics it prints. */
const POOL_TOPICS: Record<string, string> = {
  initialize: "Opened the pool",
  deposit: "Deposited",
  "deposit-stx": "Topped up the STX leg",
  withdraw: "Withdrew a queued deposit",
  stake: "Rolled into a bond",
  "bind-bond": "Bound a bond",
  "bind-next-bond": "Bound the next bond",
  "unstake-sbtc": "Wound the pool down",
  "unstake-sbtc-early": "Left mid-term",
  "request-exit": "Asked to leave at the roll",
  "cancel-exit": "Cancelled an exit",
  "sync-rewards": "Recognised rewards",
  "claim-principal": "Claimed principal",
  "claim-rewards": "Claimed honey",
  "trust-signer-manager": "Trusted a signer manager",
  "distrust-signer-manager": "Distrusted a signer manager",
  "update-operator": "Changed the operator seat",
  "update-bond-registration": "Moved the registration",
  "sweep-unattributed-principal": "Swept stray sBTC",
};

/** The bridge's topics, said the way the rest of the site says them. */
const BRIDGE_TOPICS: Record<string, string> = {
  "commit-btc-address": "Committed an address",
  "reveal-btc-address": "Revealed it",
  "complete-btc-deposit": "Credited to the pool",
  "cancel-btc-commitment": "Gave up a commitment",
  "cancel-btc-deposit": "Released an address",
  "claim-principal-to-btc": "Took principal out as bitcoin",
  "reclaim-btc-withdrawal": "Reclaimed a withdrawal",
};

function viewModel(): Scope {
  const burn = state.burn;
  const here = focused();
  const many = state.sites.length > 1;

  // ── across every deployment ────────────────────────────────────────────
  const totalSats = state.readings.reduce((n, r) => n + principal(r).total, 0);
  const totalUstx = state.readings.reduce((n, r) => n + principal(r).ustx, 0);
  const totalHoney = state.readings.reduce(
    (n, r) => n + field(r.pool?.totals, "total-credited"),
    0,
  );
  const work = state.readings.reduce(
    (acc, r) => {
      const own = openWork(r);
      return {
        ready: acc.ready + own.ready,
        lapsed: acc.lapsed + own.lapsed,
        mandates: acc.mandates + own.mandates,
      };
    },
    { ready: 0, lapsed: 0, mandates: 0 },
  );
  const waiting = allWaiting();
  const holding = allHolding();

  // ── the focused deployment ─────────────────────────────────────────────
  const totals = here?.pool?.totals ?? null;
  const held = here ? principal(here) : null;
  const extras = here?.extras ?? null;
  const preview = here?.pool?.preview ?? null;
  const live = here?.pool?.live ?? null;
  const bond = here?.pool?.bond ?? null;
  const schedule = here?.pool?.schedule ?? null;
  const cycles = here?.pool?.cycles ?? null;
  const floor = here?.floor ?? null;

  /**
   * Whether the roll can be made now, said the way the chain would answer it.
   *
   * `can-still-stake` is the pool's own read and only means "bound, and the
   * bond has not started" -- it is true from the moment of the bind, hours
   * before the window opens, and stays true through pox-5's prepare phase,
   * when `register-for-bond` answers `(err u47)` and the roll cannot be made
   * at all. Both ends of that are the difference between a bond rolled and a
   * bond missed, so both are named here.
   */
  const rollWindowNote = (): string => {
    if (!bond?.bound || extras?.canStake !== true) {
      return extras?.stakeWindow
        ? `The stake window opens at burn height ${fmt(extras.stakeWindow)}, ${relative(extras.stakeWindow, burn)}.`
        : "No bond is bound, so there is no window to wait for yet.";
    }
    const opens = Math.max(number(bond["stake-opens-at"]), number(bond["notice-ends-at"]));
    const start = number(bond["start-height"]);
    const freeze = freezeIn(opens, start, cycles);
    if (burn < opens) {
      return `The stake window opens at burn height ${fmt(opens)}, ${relative(opens, burn)}.`;
    }
    if (freeze && burn >= freeze.from) {
      return `pox-5 froze the staker set for this cycle at burn height ${fmt(freeze.from)}: ` +
        `stake reverts with (err u47) until the bond starts at ${fmt(start)}, so this bond ` +
        `can no longer be rolled into.`;
    }
    const closes = freeze ? freeze.from : start;
    return `The stake window is open, and stake is permissionless — anyone may roll it, ` +
      `until burn height ${fmt(closes)}, ${relative(closes, burn)}.`;
  };
  const activity = tally(here?.activity ?? null);
  const bridge = tally(here?.bridge ?? null);
  const movers = new Set((here?.activity ?? []).map((e) => e.who).filter(Boolean));
  const commits = counted(bridge, "commit-btc-address");
  const reveals = counted(bridge, "reveal-btc-address");
  const credits = counted(bridge, "complete-btc-deposit");
  const epochs = here?.epochs ?? [];
  const honeyEarned = epochs.reduce((n, e) => n + e.credited, 0);
  const proposals = floor?.proposals ?? [];
  const ready = proposals.filter((p) => p.status.ready);
  const open = proposals.filter((p) => p.status["voting-open"]);

  return {
    // ── the header ──────────────────────────────────────────────────────────
    walletLabel: state.connected ? shorten(state.account ?? "") : "Connect wallet",
    openWallet: () => toggleWallet(),
    walletNote: state.connected
      ? "Connected. Every call on this page moves nothing of yours but the fee."
      : "A wallet is only needed to press one of these. Reading takes none.",
    networks: SWITCHABLE.map((name) => ({
      label: name,
      note: hasDeployment(name) ? "" : "not deployed",
      bg: name === config.network ? "var(--color-accent)" : "transparent",
      fg: name === config.network ? "var(--color-bg)" : "var(--color-text)",
      choose: () => (name === config.network ? undefined : setNetwork(name)),
    })),
    burnShow: burn > 0,
    burnHeight: fmt(burn),
    pace: `a burn block is about ${plural(Math.round(blockMinutes()), "minute")} here`,
    reading: state.reading,
    reload: () => void refresh(),
    failedShow: state.failed !== "",
    failed: state.failed,

    // ── the top line ────────────────────────────────────────────────────────
    deploymentsWord: plural(state.sites.length, "deployment"),
    headline: [
      {
        label: "sBTC principal",
        value: `${btc(totalSats)} BTC`,
        note: `${fmt(totalSats)} sats the ledgers account for, across ${plural(state.sites.length, "deployment")}`,
      },
      {
        label: "STX beside it",
        value: stx(totalUstx),
        note: "queued, bonded and released legs together",
      },
      {
        label: "Honey recognised",
        value: `${btc(totalHoney)} BTC`,
        note: "reward sBTC credited to members, all time",
      },
      {
        label: "Open work",
        value: String(work.ready + work.lapsed + work.mandates),
        note: `${work.ready} to credit · ${work.lapsed} to clear · ${work.mandates} to execute`,
      },
    ],

    // ── the comparison ──────────────────────────────────────────────────────
    manyShow: many,
    compare: state.readings.map((reading) => {
      const own = principal(reading);
      const ownWork = openWork(reading);
      const epochCount = field(reading.pool?.config, "epoch-count");
      return {
        label: reading.site.label,
        pool: `${reading.site.deployer}.${reading.site.pool}`,
        poolShort: `${shorten(reading.site.deployer)}.${reading.site.pool}`,
        poolLink: explorerContract(`${reading.site.deployer}.${reading.site.pool}`),
        daoName: reading.site.dao,
        bridgeName: reading.site.bridge,
        sats: `${btc(own.total)} BTC`,
        satsNote: `${fmt(own.total)} sats`,
        ustx: stx(own.ustx),
        epochs: epochCount > 0 ? plural(epochCount, "epoch") : "never staked",
        state: reading.pool?.live
          ? `bond ${fmt(field(reading.pool.live as unknown as Record<string, Plain>, "bond-index"))} live`
          : reading.pool?.bond?.stakeable
            ? "a bond is bound"
            : reading.pool?.config?.["finished"] === true
              ? "wound down"
              : "idle",
        proposals: String((reading.floor?.proposals ?? []).length),
        work: String(ownWork.ready + ownWork.lapsed + ownWork.mandates),
        // The one place the deployments genuinely differ today, and the reason
        // the page asks rather than assumes.
        keeper: reading.keepable ? "bridge v2" : "bridge v1 — no work list",
        keeperDim: reading.keepable ? "1" : "0.55",
        failedShow: reading.failed !== "",
        failed: reading.failed,
        focused: idOf(reading.site) === (here ? idOf(here.site) : ""),
        focus: () => setState({ focus: idOf(reading.site) }),
      };
    }),

    // ── open work, across everything ────────────────────────────────────────
    workNote:
      `Nothing here is enumerable from a contract call, so each row was found in ` +
      `an event log and then confirmed against the map it came from. What is ` +
      `listed is what is standing this minute.`,
    waitingCount: String(waiting.length),
    waitingEmpty: !state.reading && waiting.length === 0,
    waiting: waiting.map(({ row, reading }, index) => {
      const candidates = row.candidates ?? [];
      const lapsed = burn > 0 && burn >= row.lapsesAt;
      const anyReady = candidates.some((candidate) => candidate.ready);
      return {
        where: reading.site.label,
        whereShow: many,
        member: row.member,
        memberShort: shorten(row.member),
        memberLink: explorerContract(row.member),
        amount: written(row.sats),
        stx: stx(row.ustx),
        announced: fmt(row.announcedAt),
        announcedAgo: relative(row.announcedAt, burn),
        addressShow: row.text !== "",
        address: row.text,
        addressShort: middle(row.text, 16, 10),
        addressLink: bitcoin().explorer ? `${bitcoin().explorer}/address/${row.text}` : "",
        addressLinkShow: Boolean(bitcoin().explorer) && row.text !== "",
        script: `0x${row.script}`,
        revealLink: explorerTx(row.tx),
        revealShow: row.tx !== "",
        word: anyReady ? "ready to credit" : lapsed ? "lapsed" : "waiting",
        wordBg: anyReady
          ? "var(--color-accent-2-100)"
          : lapsed
            ? "var(--color-accent-100)"
            : "var(--color-neutral-100)",
        wordFg: anyReady
          ? "var(--color-accent-2-800)"
          : lapsed
            ? "var(--color-accent-800)"
            : "var(--color-neutral-800)",
        lapses: lapsed
          ? `Its ${duration(ANNOUNCE_TTL)} are up — anyone may release it`
          : `Anyone may release it from burn height ${fmt(row.lapsesAt)}, ${relative(row.lapsesAt, burn)}`,
        // Releasing an announcement whose bitcoin is on its way would be the
        // one harmful press on this page, so the button says which it is.
        releaseShow: lapsed,
        releaseDim: anyReady ? "0.45" : "1",
        releaseNote: anyReady
          ? "There is a swept deposit against this address. Credit it rather than releasing it — a release now strands those sats."
          : "Hands the STX leg back to the member and frees the pool's room.",
        release: () => void releaseAddress(row, reading.site),
        scanning: row.candidates === null && index < SCAN_DEPTH,
        unscanned: row.candidates === null && index >= SCAN_DEPTH,
        blindShow: row.blind !== "",
        blind: row.blind,
        noneFound: row.candidates !== null && candidates.length === 0 && row.blind === "",
        deposits: candidates.map((candidate) => ({
          txidShort: middle(candidate.txid, 12, 8),
          txid: candidate.txid,
          txidLink: explorerBtcTx(candidate.txid),
          txidLinkShow: explorerBtcTx(candidate.txid) !== "",
          vout: String(candidate.vout),
          amount: written(candidate.sats),
          to: middle(candidate.to, 14, 8),
          where: candidate.height === null ? "in the mempool" : `bitcoin block ${fmt(candidate.height)}`,
          swept: candidate.swept
            ? `swept ${written(candidate.swept.sats)} at burn height ${fmt(candidate.swept.at)}`
            : "not swept yet",
          why: candidate.why,
          ready: candidate.ready,
          complete: () => void complete(row, candidate, reading.site),
        })),
      };
    }),

    holdingShow: holding.length > 0,
    holdingCount: String(holding.length),
    commitTtl: duration(COMMIT_TTL),
    holding: holding.map(({ row, reading }) => {
      const lapsed = burn > 0 && burn >= row.lapsesAt;
      return {
        where: reading.site.label,
        whereShow: many,
        memberShort: shorten(row.member),
        memberLink: explorerContract(row.member),
        amount: written(row.sats),
        stx: stx(row.ustx),
        committed: fmt(row.committedAt),
        digest: middle(`0x${row.digest}`, 12, 8),
        when: lapsed
          ? `Its ${duration(COMMIT_TTL)} are up — anyone may cancel it`
          : `Only the member may cancel it until burn height ${fmt(row.lapsesAt)}, ${relative(row.lapsesAt, burn)}`,
        cancelShow: lapsed,
        cancel: () => void releaseCommitment(row, reading.site),
        txLink: explorerTx(row.tx),
        txShow: row.tx !== "",
      };
    }),

    // ── which deployment the detail is about ────────────────────────────────
    focusLabel: here?.site.label ?? "",
    focusPool: here ? `${here.site.deployer}.${here.site.pool}` : "",
    focusPoolLink: here ? explorerContract(`${here.site.deployer}.${here.site.pool}`) : "",
    focusDao: here ? `${here.site.deployer}.${here.site.dao}` : "",
    focusDaoLink: here ? explorerContract(`${here.site.deployer}.${here.site.dao}`) : "",
    focusBridge: here ? `${here.site.deployer}.${here.site.bridge}` : "",
    focusBridgeLink: here ? explorerContract(`${here.site.deployer}.${here.site.bridge}`) : "",
    picker: state.readings.map((reading) => ({
      label: reading.site.label,
      bg: idOf(reading.site) === (here ? idOf(here.site) : "")
        ? "var(--color-accent)"
        : "transparent",
      fg: idOf(reading.site) === (here ? idOf(here.site) : "")
        ? "var(--color-bg)"
        : "var(--color-text)",
      choose: () => setState({ focus: idOf(reading.site) }),
    })),

    // ── the balance sheet ───────────────────────────────────────────────────
    sheetShow: totals !== null,
    sheet: [
      { label: "In the bond", value: written(held?.bonded ?? 0), note: `${stx(field(totals, "bonded-ustx"))} locked with it in pox-5` },
      { label: "Queued", value: written(held?.queued ?? 0), note: `${stx(field(totals, "queued-ustx"))} beside it — withdrawable on demand` },
      { label: "Released", value: written(held?.released ?? 0), note: `${stx(field(totals, "released-ustx"))} — claimable now` },
      { label: "Withdrawing", value: written(field(totals, "withdrawing-sats")), note: "principal on its way out to bitcoin" },
      {
        label: "Leaving at the roll",
        value: written(field(totals, "exiting-sats")),
        note:
          (held?.bonded ?? 0) > 0
            ? `${share(field(totals, "exiting-sats"), held!.bonded)} of the bonded position`
            : "nothing is bonded, so nothing is queued to leave one",
      },
      { label: "Announced", value: written(field(totals, "announced-sats")), note: "room the bridge is holding for deposits in flight" },
      { label: "Honey recognised", value: written(field(totals, "total-credited")), note: `${written(field(totals, "total-paid"))} of it claimed` },
      { label: "Honey unclaimed", value: written(field(totals, "unclaimed-rewards")), note: "credited to members and not yet drawn" },
    ],
    // The three reads that explain the eight above: what the treasury really
    // holds, and the two ways that can differ from what the books say it owes.
    extrasShow: extras !== null,
    extras: [
      { label: "Treasury balance", value: extras?.treasury === null || extras === null ? "—" : written(extras.treasury), note: "sBTC the treasury actually holds" },
      { label: "Unattributed", value: extras?.unattributed === null || extras === null ? "—" : written(extras.unattributed), note: "held above everything the books owe — a sweep's to move" },
      { label: "Unrecognised honey", value: extras?.unrecognized === null || extras === null ? "—" : written(extras.unrecognized), note: "arrived and not yet split. sync-rewards is what splits it" },
      { label: "Committing", value: extras?.committing === null || extras === null ? "—" : written(extras.committing), note: "what the next roll would try to carry" },
    ],
    syncShow: Boolean(here) && (extras?.unrecognized ?? 0) >= 0,
    syncNote:
      "Permissionless. It recognises reward sBTC that has arrived and splits it " +
      "by the shares held while it was earned — which is what a member leaving " +
      "early would otherwise forfeit.",
    sync: () => here && void syncRewards(here.site),

    // ── what the next roll would do ─────────────────────────────────────────
    rollShow: preview !== null,
    rollEligible: preview ? written(number(preview["eligible-sats"])) : "",
    rollFits: preview ? written(number(preview.sats)) : "",
    rollScale: preview
      ? share(number(preview.sats), number(preview["eligible-sats"]))
      : "",
    rollUstx: preview ? stx(number(preview.ustx)) : "",
    rollShort: preview && number(preview["short-ustx"]) > 0
      ? `${stx(number(preview["short-ustx"]))} short of what those sats need`
      : "the STX leg covers it",
    rollLimit: preview
      ? preview["stx-limited"]
        ? "STX-limited — more sats than the STX beside them can carry"
        : preview["allocation-limited"]
          ? "allocation-limited — the bond has no more room for this pool"
          : "nothing is holding it back"
      : "",
    rollWindow: rollWindowNote(),
    bondShow: Boolean(bond?.bound),
    bondIndex: bond ? fmt(number(bond["bond-index"])) : "",
    bondStart: bond
      ? `Starts at burn height ${fmt(number(bond["start-height"]))}, ${relative(number(bond["start-height"]), burn)}`
      : "",
    bondRoom: bond
      ? `${written(number(bond["max-sats"]))} allocated to this pool`
      : "",
    scheduleShow: schedule !== null,
    scheduleNow: schedule?.current
      ? `Bond ${fmt(schedule.current.index)} is running with ${written(schedule.current.staked)} staked across every pool and staker.`
      : "No bond period has opened yet.",
    scheduleNext: schedule
      ? `Bond ${fmt(schedule.next.index)} opens at burn height ${fmt(schedule.next.start)}, ${relative(schedule.next.start, burn)}` +
        (schedule.next.allowance === null
          ? " — this pool is not on its allowlist"
          : ` — ${written(schedule.next.allowance)} allowed to this pool`)
      : "",
    // A pool's share of the bond it is in, which is the one number that says
    // how big it is next to everybody else staking the same bond.
    poolShareShow: Boolean(live && schedule?.current),
    poolShare:
      live && schedule?.current && schedule.current.staked > 0
        ? `${share(number(live["staked-sats"]), schedule.current.staked)} of every sat staked into bond ${fmt(schedule.current.index)}`
        : "",

    // ── epochs ──────────────────────────────────────────────────────────────
    epochsShow: epochs.length > 0,
    epochsEmpty: epochs.length === 0,
    epochsNote: `${plural(epochs.length, "epoch")} opened, ${written(honeyEarned)} of honey credited across them`,
    epochs: epochs
      .slice()
      .reverse()
      .map((epoch) => ({
        index: String(epoch.index),
        bond: fmt(epoch["bond-index"]),
        staked: written(epoch["staked-sats"]),
        ustx: stx(epoch["staked-ustx"]),
        // The roll's own scale-back: what wanted in against what fitted.
        scale: share(epoch["staked-sats"], epoch["eligible-sats"]),
        scaleNote:
          epoch["staked-sats"] < epoch["eligible-sats"]
            ? `${written(epoch["eligible-sats"] - epoch["staked-sats"])} was released rather than carried`
            : "everything eligible was carried",
        shares: written(epoch["total-shares"]),
        sharesNote:
          epoch["total-shares"] < epoch["staked-sats"]
            ? `${written(epoch["staked-sats"] - epoch["total-shares"])} has left mid-term`
            : "nobody has left mid-term",
        credited: written(epoch.credited),
        yield: share(epoch.credited, epoch["staked-sats"]),
        cycle: fmt(epoch["first-reward-cycle"]),
        unlock: `${fmt(epoch["unlock-burn-height"])} ${relative(epoch["unlock-burn-height"], burn)}`,
      })),

    // ── what members have done ──────────────────────────────────────────────
    activityShow: (here?.activity ?? []).length > 0,
    activityNote:
      `The last ${plural((here?.activity ?? []).length, "event")} ${here?.site.label ?? "the pool"} printed. ` +
      `${plural(movers.size, "principal")} appear in it — the ledger keys members by ` +
      `principal and never counts them, so this is who has acted in the window, ` +
      `not who holds a position.`,
    activity: [
      { label: "Deposits", value: String(counted(activity, "deposit").count), note: written(counted(activity, "deposit").sats) },
      { label: "STX top-ups", value: String(counted(activity, "deposit-stx").count), note: stx(counted(activity, "deposit-stx").ustx) },
      { label: "Withdrawals", value: String(counted(activity, "withdraw").count), note: written(counted(activity, "withdraw").sats) },
      { label: "Exits asked for", value: String(counted(activity, "request-exit").count), note: `${counted(activity, "cancel-exit").count} cancelled again` },
      { label: "Early exits", value: String(counted(activity, "unstake-sbtc-early").count), note: written(counted(activity, "unstake-sbtc-early").sats) },
      { label: "Rolls", value: String(counted(activity, "stake").count), note: `${counted(activity, "bind-bond").count + counted(activity, "bind-next-bond").count} bonds bound` },
      { label: "Reward syncs", value: String(counted(activity, "sync-rewards").count), note: "permissionless, and anyone's to make" },
      { label: "Claims", value: String(counted(activity, "claim-principal").count + counted(activity, "claim-rewards").count), note: "principal and honey together" },
    ],
    recent: (here?.activity ?? []).slice(0, 25).map((entry) => ({
      what: POOL_TOPICS[entry.topic] ?? entry.topic,
      who: entry.who ? shorten(entry.who) : "—",
      whoLink: entry.who ? explorerContract(entry.who) : "",
      whoShow: entry.who !== "",
      sats: entry.sats > 0 ? written(entry.sats) : "—",
      ustx: entry.ustx > 0 ? stx(entry.ustx) : "—",
      txLink: explorerTx(entry.tx),
    })),

    // ── the bridge funnel ───────────────────────────────────────────────────
    bridgeShow: (here?.bridge ?? []).length > 0,
    bridgeBlocked: Boolean(here) && !here!.keepable,
    bridgeBlockedNote: here
      ? `${here.site.bridge} is the first bridge protocol: it committed to the ` +
        `transaction rather than to the address, and it has no ` +
        `get-announcement-by-script, so announcements against it cannot be ` +
        `enumerated from here. Its events are still counted below.`
      : "",
    funnel: [
      { label: "Commitments", value: String(commits.count), note: `${written(commits.sats)} committed to` },
      { label: "Reveals", value: String(reveals.count), note: `${share(reveals.count, commits.count)} of commitments got this far` },
      { label: "Credited", value: String(credits.count), note: `${share(credits.count, reveals.count)} of reveals finished` },
      { label: "Bridged in", value: written(credits.sats), note: "sBTC the bridge has credited to positions" },
      { label: "Given up", value: String(counted(bridge, "cancel-btc-commitment").count + counted(bridge, "cancel-btc-deposit").count), note: "commitments and addresses released again" },
      { label: "Out to bitcoin", value: String(counted(bridge, "claim-principal-to-btc").count), note: written(counted(bridge, "claim-principal-to-btc").sats) },
    ],
    bridgeLogNote: `The last ${plural((here?.bridge ?? []).length, "event")} ${here?.site.bridge ?? "the bridge"} printed, newest first. Older ones are an indexer's job.`,
    bridgeLog: (here?.bridge ?? []).slice(0, 25).map((entry) => ({
      what: BRIDGE_TOPICS[entry.topic] ?? entry.topic,
      who: shorten(entry.member),
      whoLink: explorerContract(entry.member),
      amount: entry.sats > 0 ? written(entry.sats) : "—",
      stx: entry.ustx > 0 ? stx(entry.ustx) : "—",
      txLink: explorerTx(entry.tx),
      btcShow: entry.txid !== "" && explorerBtcTx(entry.txid) !== "",
      btcShort: middle(entry.txid, 10, 6),
      btcLink: explorerBtcTx(entry.txid),
    })),

    // ── the floor ───────────────────────────────────────────────────────────
    floorNote: floor
      ? `${plural(proposals.length, "proposal")} raised, quorum ${fmt(floor.quorum)} by weight, epoch ${fmt(floor.epoch)}`
      : "This deployment's DAO could not be read.",
    floorCounts: [
      { label: "Executed", value: String(proposals.filter((p) => p.status.executed).length), note: "mandates that landed" },
      { label: "Carried, unspent", value: String(ready.length), note: "anyone may execute these" },
      { label: "Open", value: String(open.length), note: "still being voted on" },
      { label: "Expired", value: String(proposals.filter((p) => p.status.expired).length), note: "the window closed on them" },
    ],
    readyShow: ready.length > 0,
    readyCount: String(ready.length),
    ready: ready.map((entry) => ({
      id: String(entry.id),
      kind: entry.proposal.kind,
      proposer: shorten(entry.proposal.proposer),
      votes: `${fmt(entry.proposal.yes)} for · ${fmt(entry.proposal.no)} against · quorum ${fmt(entry.status.quorum)}`,
      window: `Executable from burn height ${fmt(entry.status["executable-from"])}${
        burn ? `, ${relative(entry.status["executable-from"], burn)}` : ""
      }`,
      execute: () => here && void execute(entry, here.site),
    })),
    openShow: open.length > 0,
    open: open.map((entry) => ({
      id: String(entry.id),
      kind: entry.proposal.kind,
      votes: `${fmt(entry.proposal.yes)} for · ${fmt(entry.proposal.no)} against`,
      turnout: `${share(entry.status["votes-cast"], entry.status.quorum)} of quorum`,
      closes: `Voting closes at burn height ${fmt(entry.proposal["voting-ends-at"])}${
        burn ? `, ${relative(entry.proposal["voting-ends-at"], burn)}` : ""
      }`,
    })),
    floorQuiet: ready.length === 0 && open.length === 0,
    floorQuietNote: floor
      ? "Nothing is open for a vote and no mandate is waiting to be spent."
      : "Nothing to read: this deployment's DAO did not answer.",

    // ── the contract's own self-checks ──────────────────────────────────────
    checksShow: (here?.checks ?? []).length > 0,
    checksNote:
      "The properties the pool's own test suite holds it to, exposed as reads " +
      "so anyone can hold it to them on chain. Only the ones taking no argument " +
      "are asked here; a deployment without them has no section.",
    checks: (here?.checks ?? []).map((check) => ({
      // The function name is the sentence, near enough: `invariant-paid-within-
      // credited` says what it checks better than a translation of it would.
      name: check.name.replace(/^invariant-/, "").replace(/-/g, " "),
      holds: check.holds === true ? "holds" : check.holds === false ? "BROKEN" : "unreadable",
      bg: check.holds === true
        ? "var(--color-accent-2-100)"
        : check.holds === false
          ? "var(--color-accent-100)"
          : "var(--color-neutral-100)",
      fg: check.holds === true
        ? "var(--color-accent-2-800)"
        : check.holds === false
          ? "var(--color-accent-800)"
          : "var(--color-neutral-800)",
    })),

    // ── the footer ──────────────────────────────────────────────────────────
    network: config.network,
    btcChain: bitcoin().chain,
    btcApiShow: Boolean(bitcoin().api),
    btcApi: bitcoin().api,
    nodeApi: net().api,
    windowNote: `Every count on this page is over the last ${LOG_DEPTH} events of the contract it is about.`,
    // The same claim as the main page's footer, drawn from the network rather
    // than written into the markup: "testnet-only" stopped being true when the
    // `-1` set went to mainnet.
    statusNote:
      config.network === "mainnet"
        ? "Live on mainnet: the contracts are unaudited."
        : `Rehearsal on ${config.network}: contracts unaudited, no mainnet funds.`,
  };
}

/// --- mount --------------------------------------------------------------------------

function render(): void {
  const template = document.getElementById("tpl") as HTMLTemplateElement | null;
  const mount = document.getElementById("app");
  if (!template || !mount) return;
  mountInto(template, mount, viewModel());

  const bar = document.getElementById("notice");
  if (bar) {
    bar.textContent = state.notice;
    bar.hidden = !state.notice;
  }
}

// Paint first, then read: the page explains itself either way, and a slow node
// should not hold up the text.
render();

if (configured()) {
  void chainApi().then((api) => {
    const account = api.loadAccount();
    setState({ account, connected: Boolean(account) });
    void refresh();
  });
} else {
  void refresh();
}
