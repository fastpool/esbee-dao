// Esbee DAO — the vote floor.
//
// Two modes, decided by whether `chain.ts` has a deployer address:
//
//   configured    every number is read from `esbee-dao` and `bond-staker`,
//                 votes are real `vote` transactions through the wallet
//   unconfigured  the design's fixtures, so the page still explains itself
//                 before anything is deployed. Labelled as a rehearsal.
//
// The fixtures are not invented state: every proposal below is one of the five
// calls the contract actually has, and the copy describes what that call does.
import { mountInto, type Scope } from "./render.js";
import {
  addressExample,
  apiBase,
  bitcoin,
  blockMinutes,
  config,
  configured,
  explorerBtcTx,
  explorerContract,
  explorerTx,
  hasDeployment,
  net,
  onConfiguredChain,
  poolContract,
  setNetwork,
  SWITCHABLE,
  walletNetworkAdvice,
} from "./config.js";
import { num } from "./plain.js";
import { beeIdentity, discuss, mountChat, syncChat } from "./chat.js";
import type {
  BridgeEvent,
  MemberPosition,
  PoxAddress,
  Floor,
  FloorEntry,
  PoolState,
  ProposalStatus,
  StoredProposal,
} from "./chain.js";

/**
 * The chain layer, loaded only when there is a deployment to talk to.
 *
 * stacks.js and the wallet SDK are the bulk of this page's JavaScript, and a
 * reader who never connects should not pay for them. `config.ts` is
 * dependency-free precisely so this decision can be made before loading it.
 */
type ChainModule = typeof import("./chain.js");
let chain: ChainModule | null = null;
const chainApi = async (): Promise<ChainModule> =>
  (chain ??= await import("./chain.js"));

/// --- types --------------------------------------------------------------------

type Tone = { bg: string; fg: string };

/** A proposal as the design's markup wants to read it. */
interface ProposalBase {
  id: number;
  kind: string;
  rawKind?: string;
  state: string;
  tone: Tone;
  title: string;
  blurb: string;
  detail: string;
  yes: number;
  no: number;
  open: boolean;
  gateState: number[];
  closes: string;
  mine?: "for" | "against" | null;
}

interface ProposalView extends Omit<ProposalBase, "open"> {
  /** This row is one of the design's fixtures, not something on chain. */
  dummy: boolean;
  yesLabel: string;
  noLabel: string;
  yesW: string;
  noW: string;
  approval: string;
  turnout: string;
  chips: { text: string; bg: string; fg: string }[];
  gateRows: { label: string; value: string; icon: string; dot: string; fg: string }[];
  voted: string;
  showVoted: boolean;
  canVote: boolean;
  needsWallet: boolean;
  open: () => void;
  voteYes: () => void;
  voteNo: () => void;
  run: () => void;
  discuss: () => void;
}

type Vote = "for" | "against";

interface State {
  connected: boolean;
  account: string | null;
  walletOpen: boolean;
  sel: number | null;
  votes: Record<number, Vote>;
  floor: Floor | null;
  pool: PoolState | null;
  notice: string;
  memberSats: number;
  member: MemberPosition | null;
  /** The principal an sBTC deposit has to credit. Not a bitcoin address. */
  depositTo: string;
  /**
   * Which way the member has chosen to pay, once they have chosen.
   *
   * "" until then: the amount, the STX leg and the address are the same
   * questions either way, so they are asked first and the route is asked last,
   * when the member can see what each one would cost them.
   */
  route: Route;
  /**
   * A step the member has opened to look back at, or null for "wherever I am".
   *
   * The wait at step 4 is long, and the things worth checking during it -- the
   * address the bitcoin was told to go to, the hash that was committed -- all
   * belong to steps already behind them. Without this the only way to see one
   * again is to un-do the route.
   */
  review: number | null;
  /**
   * What the wallet's bitcoin address holds on L1, in sats, or null where it
   * has not been read. A member choosing between the two routes is choosing
   * between two balances, so both are on the card before the choice is made.
   */
  btcBalance: number | null;
  /** The L1 route's own fields, held across a re-render like the join card's. */
  btcAddress: string;
  /**
   * The connected wallet's own bitcoin address, where it has one on the chain
   * this page is about. "" when no wallet is connected, or when the only
   * addresses it handed over belong to another bitcoin.
   *
   * Kept beside the field rather than written into it: it prefills an empty
   * field, but a member who has typed an address of their own gets it offered
   * next to what they wrote, never over the top of it.
   */
  walletBtc: string;
  /** The deposit's txid and output index, held like the two fields above. */
  btcTxid: string;
  btcVout: string;
  /** The bitcoin the faucet last sent, so the card can link to it. */
  btcFaucetTx: string;
  /** What the chain says about the address in the field. Read on demand. */
  l1Chain: L1Chain | null;
  /** The deposit address this page derived, once it has derived one. */
  deposit: DepositTarget | null;
  /**
   * What Emily says about the deposit, which is the only place the *middle* of
   * this route is visible.
   *
   * The chain answers two questions -- has it been announced, has it been
   * swept -- and between them is a wait the member cannot see into at all: the
   * bitcoin is confirmed, nothing has happened on Stacks yet, and the page had
   * nothing to say. This is what the signers think they are doing with it.
   */
  emily: { status: string; message: string; lockTime: number } | null;
  /**
   * What this member has done on the bridge before, newest first, or null
   * until it is asked for. Asked for rather than loaded: it is an event-log
   * scan, and most visits do not want it.
   */
  history: BridgeEvent[] | null;
  historyReading: boolean;
  /** Last quoted STX leg, in uSTX, for whatever is typed in the sats field. */
  quotedFor: number;
  quotedUstx: number;
  /** What the amount field is written in. Sats is the contract's own unit. */
  unit: Unit;
  /** The amount as typed, so a re-render can put it back where it was. */
  amount: string;
  /** The same, for the early exit's own field. Sats, and only sats. */
  earlyAmount: string;
  /** A deposit the wallet accepted, followed until it settles. */
  pending: Pending | null;
  /**
   * Which proposals the floor shows: `true` the fixtures, `false` the chain,
   * `null` whichever the chain justifies -- live if it has any, fixtures if
   * not, which is what a reader arriving at an empty deployment wants.
   */
  dummy: boolean | null;
}

type Unit = "sats" | "sbtc";

/** The two ways in, and "" for a member who has not picked one yet. */
type Route = "" | "sbtc" | "l1";

/** Where an sBTC deposit has to be sent, and what proves what it was for. */
interface DepositTarget {
  address: string;
  depositScript: string;
  reclaimScript: string;
  sats: number;
  /** What it was built from, so it can be rebuilt somewhere that is not here. */
  recipient?: string;
  signersPublicKey?: string;
  reclaimPublicKey?: string;
  maxSignerFee?: number;
  reclaimLockTime?: number;
}

interface Pending {
  txid: string;
  /** `tx_status` as the API spells it: pending, success, abort_by_response... */
  status: string;
}

/**
 * Where the member stands on the L1 route, as the bridge itself has it.
 *
 * The route spans several transactions and at least one bitcoin block, so
 * "where am I" is a question only the chain can answer -- and until this was
 * read, the card could only offer five buttons and hope. Everything here is
 * keyed on one address: the one in the field, which is what every read below
 * was made against.
 */
interface L1Chain {
  /** The address these reads were made against, so a stale one is not shown. */
  address: string;
  /** `get-address-digest` for that address and this browser's salt, or "". */
  digest: string;
  /** Whether the salt is here at all. Without it a commitment cannot be used. */
  salt: boolean;
  /** `get-commitment`: made, not yet revealed. */
  commitment: { sats: number; ustx: number; at: number } | null;
  /**
   * `get-announcement`: revealed, and the bitcoin has not been credited yet.
   *
   * Carries whose it is, which the commitment does not have to: commitments are
   * keyed by `(member, digest)` and so are already this member's, while an
   * announcement is keyed by the funding script alone. Anyone's reveal of an
   * address is what the bridge holds against it, and the sats will go to
   * whoever that was -- so the card has to know whether that is the account
   * looking at it.
   */
  announcement: { member: string; sats: number; ustx: number; at: number } | null;
  /** `get-credited-deposit` for the txid in the field, if there is one. */
  credited: { sats: number } | null;
  /**
   * Whether the sBTC registry holds a completed deposit for it -- the signers
   * have swept, and step 5 would go through. The one honest way to tell the
   * wait from the thing the wait is for.
   */
  swept: boolean;
  /** That txid, so a credit is not shown against a different deposit. */
  txid: string;
  /** The burn height the rest of this was read against. */
  burn: number;
}

/// --- state ------------------------------------------------------------------

const state: State = {
  connected: false,
  account: null,
  walletOpen: false,
  sel: null,
  votes: {}, // local echo, until the vote confirms
  floor: null, // from chain, or null
  pool: null,
  notice: "",
  memberSats: 10_000_000, // only used to size the rehearsal's weight
  member: null,
  depositTo: "",
  route: "",
  review: null,
  btcBalance: null,
  btcAddress: "",
  walletBtc: "",
  btcTxid: "",
  btcVout: "0",
  btcFaucetTx: "",
  l1Chain: null,
  deposit: null,
  emily: null,
  history: null,
  historyReading: false,
  quotedFor: 0,
  quotedUstx: 0,
  unit: "sats",
  amount: "",
  earlyAmount: "",
  pending: null,
  dummy: null,
};

function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  Object.assign(state, typeof patch === "function" ? patch(state) : patch);
  render();
}

const fmt = (n: number): string => Number(n).toLocaleString("en-US");
const shorten = (a: string | null): string =>
  a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";

/**
 * A long value with its middle taken out, for a card that must not scroll
 * sideways. Both ends are kept because both ends are what a member checks an
 * address or a hash by; the whole of it is a `title` and a copy button away.
 */
const middle = (value: string, head = 14, tail = 10): string =>
  value.length > head + tail + 1
    ? `${value.slice(0, head)}…${value.slice(-tail)}`
    : value;

/** Hand a value to the clipboard, and say so. */
async function copy(value: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    setState({ notice: `${what} copied.` });
  } catch {
    setState({
      notice: `Could not copy — the whole of it is in the field's tooltip, to select by hand.`,
    });
  }
}

/// --- the rehearsal ------------------------------------------------------------

const HIVE_WEIGHT = 24180;

function baseProposals(): ProposalBase[] {
  return [
    {
      id: 4,
      kind: "propose-trust-signer",
      state: "Voting open",
      tone: { bg: "var(--color-accent-2-200)", fg: "var(--color-accent-2-800)" },
      title: "Trust signer manager 0x9f3c…a12b",
      blurb:
        "Adds a vetted manager hash to the trusted list. Adoption is pinned to the next roll — the only moment a member can leave.",
      detail:
        "trust-signer-manager takes a code hash rather than a principal, so a manager contract can be vetted before it is even deployed. It takes effect when the pool next rolls, not after a fixed number of blocks: a delay measured in cycles would give notice a member could not act on, since request-exit is honoured at the roll and that may be six months out.",
      yes: 6431, no: 812, open: true, gateState: [1, 1, 1, 0, 0, 1], closes: "1d 6h left",
    },
    {
      id: 3,
      kind: "propose-signer-change",
      state: "In execution delay",
      tone: { bg: "var(--color-accent-200)", fg: "var(--color-accent-800)" },
      title: "Move bond registration onto signer-manager v2",
      blurb:
        "Carried with 91% approval. Lands in 14 hours — long enough for anyone who dislikes it to request an exit first.",
      detail:
        "update-bond-registration can only move onto a hash that was already trusted before the live epoch was staked. That is the emergency switch, for a manager that has stopped signing — and the execution delay exists so members who disagree can request-exit before the mandate lands.",
      yes: 9902, no: 940, open: false, gateState: [1, 1, 1, 0, 1, 1], closes: "executable in 14h",
    },
    {
      id: 2,
      kind: "propose-operator-change",
      state: "Ready to execute",
      tone: { bg: "var(--color-accent-2-300)", fg: "var(--color-accent-2-900)" },
      title: "Retire the deployer key from the operator seat",
      blurb: "All six gates cleared. Execution is permissionless — anyone can land it.",
      detail:
        "The deployer necessarily holds the operator seat through the launch window, because the DAO cannot vote before the pool has staked: voting weight is committed shares, and there are none until then. This is the hive taking the key back. The DAO cannot remove itself from the seat — bond-staker refuses to change the caller’s own entry.",
      yes: 11840, no: 610, open: false, gateState: [1, 1, 1, 1, 1, 1], closes: "window closes in 5d",
    },
    {
      id: 1,
      kind: "propose-sweep",
      state: "Expired",
      tone: { bg: "var(--color-neutral-300)", fg: "var(--color-neutral-800)" },
      title: "Sweep unattributed principal to the treasury balance",
      blurb:
        "Carried, then sat past its week-long execution window. A stale mandate cannot be dusted off later.",
      detail:
        "Anything that reaches the treasury without an announcement is unattributed, and only sweep-unattributed-principal can move it — measured as the balance above everything owed, so it can never reach member principal. This one carried and then lapsed: the window is what stops an old vote being spent against a hive that has since changed.",
      yes: 7204, no: 1533, open: false, gateState: [1, 1, 1, 1, 0, 1], closes: "lapsed 2d ago",
    },
  ];
}

const gateLabels = (): string[] => [
  "Voting period · ~2 days",
  "Quorum · 30% of the hive",
  "Supermajority · 60% of votes cast",
  "Execution delay · ~1 day",
  "Execution window · ~1 week",
  "Same epoch throughout",
];

/// --- chain -> the design's shape -------------------------------------------------

/** "1 hour", "3 hours" -- a count and its unit, said the way a person would. */
const plural = (n: number, unit: string): string =>
  `${n} ${unit}${n === 1 ? "" : "s"}`;

// A burn block is not ten minutes everywhere -- see `blockMinutes` in
// config.ts -- and a countdown drawn at the wrong pace is what makes a window
// look further off than it is. Whole hours either way, which is all the
// precision these countdowns need.
//
// Spelled out rather than abbreviated: "2 days 19 hours" is what someone
// reads, and "2d 19h" is what someone parses.
function duration(blocks: number): string {
  const hours = Math.round((Math.abs(blocks) * blockMinutes()) / 60);
  if (hours < 1) return "under an hour";
  if (hours < 48) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0
    ? plural(days, "day")
    : `${plural(days, "day")} ${plural(rest, "hour")}`;
}

/**
 * A wait of a few blocks, in minutes.
 *
 * `duration` rounds to whole hours and says "under an hour" below that, which
 * is right for a bond's windows and useless for the one block the reveal waits
 * on: a member deciding whether to sit and wait needs the number. At the
 * network's own pace, like every other countdown here.
 */
const shortWait = (blocks: number): string =>
  `about ${plural(Math.max(1, Math.round(Math.abs(blocks) * blockMinutes())), "minute")}`;

function untilBurn(target: number, now: number): string {
  const blocks = target - now;
  return blocks <= 0 ? "closed" : `${duration(blocks)} left`;
}

/** "in 3d 4h" / "2d 1h ago" -- signed, for a timeline that runs both ways. */
function relative(target: number, now: number): string {
  const blocks = target - now;
  if (blocks === 0) return "now";
  return blocks > 0 ? `in ${duration(blocks)}` : `${duration(blocks)} ago`;
}

const TONES: Record<string, Tone> = {
  "Voting open": { bg: "var(--color-accent-2-200)", fg: "var(--color-accent-2-800)" },
  "In execution delay": { bg: "var(--color-accent-200)", fg: "var(--color-accent-800)" },
  "Ready to execute": { bg: "var(--color-accent-2-300)", fg: "var(--color-accent-2-900)" },
  Executed: { bg: "var(--color-neutral-200)", fg: "var(--color-neutral-800)" },
  Expired: { bg: "var(--color-neutral-300)", fg: "var(--color-neutral-800)" },
  Rejected: { bg: "var(--color-neutral-300)", fg: "var(--color-neutral-800)" },
};

/** Six gates out of the status tuple, in the order the design lists them. */
function gateStateOf(status: ProposalStatus, burn: number): number[] {
  return [
    status["voting-open"] ? 0 : 1,
    status["met-quorum"] ? 1 : 0,
    status.approved ? 1 : 0,
    burn >= num(status["executable-from"]) ? 1 : 0,
    status.expired ? 0 : 1,
    status["same-epoch"] ? 1 : 0,
  ];
}

function labelOf(status: ProposalStatus, burn: number): string {
  if (status.executed) return "Executed";
  if (status["voting-open"]) return "Voting open";
  if (status.expired) return "Expired";
  if (!status["met-quorum"] || !status.approved) return "Rejected";
  if (!status["same-epoch"]) return "Expired";
  return burn >= num(status["executable-from"])
    ? "Ready to execute"
    : "In execution delay";
}

const short = (hex: string | null): string =>
  hex ? `${String(hex).slice(0, 6)}…${String(hex).slice(-4)}` : "";

const KIND_TITLES: Record<string, (p: StoredProposal) => string> = {
  "trust-signer": (p) => `Trust signer manager ${short(p["code-hash"])}`,
  "distrust-signer": (p) => `Distrust signer manager ${short(p["code-hash"])}`,
  "signer-change": (p) => `Move bond registration onto ${shorten(p.target)}`,
  "operator-change": (p) =>
    `${p.enabled ? "Seat" : "Retire"} ${shorten(p.target)} as operator`,
  sweep: (p) => `Sweep unattributed principal to ${shorten(p.target)}`,
};

const KIND_BLURBS: Record<string, string> = {
  "trust-signer":
    "Adds a vetted manager hash to the trusted list. Adoption is pinned to the next roll — the only moment a member can leave.",
  "distrust-signer":
    "Takes a manager hash off the trusted list. Removing takes effect at once, which is the right way round.",
  "signer-change":
    "Moves the pool's registration onto another trusted manager. Only onto a hash trusted before the live epoch was staked.",
  "operator-change":
    "Adds or retires an operator key. The DAO cannot remove its own entry from the seat.",
  sweep:
    "Moves bitcoin that reached the treasury without an announcement. Measured above everything owed, so it cannot reach member principal.",
};

function fromChain(entry: FloorEntry, burn: number): ProposalBase {
  const { id, proposal: p, status, mine } = entry;
  const label = labelOf(status, burn);
  const closes = status["voting-open"]
    ? untilBurn(num(p["voting-ends-at"]), burn)
    : label === "In execution delay"
      ? `executable in ${untilBurn(num(status["executable-from"]), burn)}`
      : label === "Ready to execute"
        ? "window open"
        : label.toLowerCase();

  return {
    id,
    kind: `propose-${p.kind}`,
    rawKind: p.kind,
    state: label,
    tone: TONES[label] ?? TONES.Expired,
    title: (KIND_TITLES[p.kind] ?? (() => p.kind))(p),
    blurb: KIND_BLURBS[p.kind] ?? "",
    detail:
      `${KIND_BLURBS[p.kind] ?? ""} Raised by ${shorten(p.proposer)} in epoch ${num(p.epoch)}; ` +
      `voting ${status["voting-open"] ? "closes" : "closed"} at burn ${num(p["voting-ends-at"])}, ` +
      `executable from burn ${num(status["executable-from"])}. ` +
      `Quorum is ${fmt(num(status.quorum))} by weight and ${fmt(num(status["votes-cast"]))} has been cast.`,
    yes: num(p.yes),
    no: num(p.no),
    open: status["voting-open"],
    gateState: gateStateOf(status, burn),
    closes,
    mine: mine ? (mine.support ? "for" : "against") : null,
  };
}

/// --- voting -------------------------------------------------------------------

async function cast(id: number, support: boolean): Promise<void> {
  if (!state.connected) return setState({ walletOpen: true });
  if (state.votes[id]) return;

  const choice: Vote = support ? "for" : "against";

  if (!configured()) {
    // The rehearsal: record it locally so the bars move.
    return setState((s) => ({ votes: { ...s.votes, [id]: choice } }));
  }

  try {
    setState({ notice: "Confirm the vote in your wallet…" });
    const { daoCalls } = await chainApi();
    const txid = await daoCalls.vote(id, support);
    setState((s) => ({
      votes: { ...s.votes, [id]: choice },
      notice: txid ? `Vote submitted — ${txid}` : "Vote submitted",
    }));
    if (txid) window.open(explorerTx(txid), "_blank", "noopener");
    void refresh();
  } catch (error) {
    setState({ notice: `Vote failed: ${message(error)}` });
  }
}

async function execute(p: ProposalBase): Promise<void> {
  const { executorFor } = await chainApi();
  const run = p.rawKind ? executorFor[p.rawKind] : undefined;
  if (!run) {
    return setState({
      notice:
        "A signer change has to name both managers as traits, so it cannot be executed from this page.",
    });
  }
  try {
    setState({ notice: "Confirm the execution in your wallet…" });
    const txid = await run(p.id);
    setState({ notice: txid ? `Execution submitted — ${txid}` : "Execution submitted" });
    if (txid) window.open(explorerTx(txid), "_blank", "noopener");
    void refresh();
  } catch (error) {
    setState({ notice: `Execution failed: ${message(error)}` });
  }
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/// --- the bond behind the wait ---------------------------------------------------

interface BondRow {
  label: string;
  value: string;
  when: string;
  icon: string;
  fg: string;
}

/** A milestone reads as passed or pending, the same way a gate row does. */
const row = (label: string, value: string, when: string, done: boolean): BondRow => ({
  label,
  value,
  when,
  icon: done ? "\u2713" : "\u00b7",
  fg: done ? "var(--color-accent-2-700)" : "var(--color-text)",
});

interface BondPanel {
  show: boolean;
  kicker: string;
  headline: string;
  lead: string;
  rows: BondRow[];
}

/**
 * What the pool is staked into, or waiting on, and how long that is.
 *
 * Three states, because the contract has three: nothing bound and deposits
 * closed; a bond bound and its windows still ahead; a bond live and the
 * principal locked until its term ends. Every height here is read from
 * `get-bound-bond` / `get-live-epoch` -- none of it is inferred.
 */
function bondPanel(): BondPanel {
  const pool = state.pool;
  if (!pool) {
    return {
      show: false,
      kicker: "",
      headline: "",
      lead: "",
      rows: [],
    };
  }

  const burn = pool.burn;
  const live = pool.live;
  const bond = pool.bond;

  if (live) {
    const unlock = num(live["unlock-burn-height"]);
    return {
      show: true,
      kicker: "Staked",
      headline: `Bond ${num(live["bond-index"])}`,
      lead:
        `The pool is staked and the term runs to burn ${fmt(unlock)} — ` +
        `${relative(unlock, burn)}. Principal is locked until then; rewards accrue ` +
        `over the bond's cycles and can be claimed as they settle.`,
      rows: [
        row("Staked", `${(num(live["staked-sats"]) / 1e8).toFixed(4)} BTC`, "committed", true),
        row("Staked at", `burn ${fmt(num(live["staked-at-height"]))}`, relative(num(live["staked-at-height"]), burn), true),
        row("First reward cycle", String(num(live["first-reward-cycle"])), "", true),
        row("Term ends", `burn ${fmt(unlock)}`, relative(unlock, burn), burn >= unlock),
      ],
    };
  }

  // `stakeable` is the contract's own `can-still-stake`: bound, and the start
  // still ahead. A bond that has started without the pool in it is not what
  // comes next -- it can no longer be joined and `bind-bond` may replace it --
  // so it falls through to the schedule below rather than sitting here as
  // "next bond" with dates that have all gone by.
  if (bond && bond.bound && bond.stakeable) {
    const start = num(bond["start-height"]);
    const opens = num(bond["stake-opens-at"]);
    const notice = num(bond["notice-ends-at"]);
    const unlock = num(bond["unlock-burn-height"]);
    const waiting = start > burn;
    return {
      show: true,
      kicker: "Next bond",
      headline: `Bond ${num(bond["bond-index"])}`,
      lead: waiting
        ? `Deposits are open until burn ${fmt(start)} — ${relative(start, burn)}. ` +
          `The pool stakes inside the window before that, and the term then runs ` +
          `to burn ${fmt(unlock)}, ${relative(unlock, burn)}.`
        : `This bond has started. The window to stake into it has closed.`,
      rows: [
        row("Bound at", `burn ${fmt(num(bond["bound-at-height"]))}`, relative(num(bond["bound-at-height"]), burn), true),
        row("Notice ends", `burn ${fmt(notice)}`, relative(notice, burn), burn >= notice),
        row("Stake window opens", `burn ${fmt(opens)}`, relative(opens, burn), burn >= opens),
        row("Deposits close, bond starts", `burn ${fmt(start)}`, relative(start, burn), burn >= start),
        row("Term ends", `burn ${fmt(unlock)}`, relative(unlock, burn), burn >= unlock),
      ],
    };
  }

  // Nothing the pool can be joined into: either nothing was ever bound, or a
  // bound bond started without it. What a reader wants to know is what is
  // running, why they cannot join it, and when the next chance comes -- all of
  // which is pox-5's to answer, not the pool's.
  const missed = bond?.bound ? num(bond["bond-index"]) : null;
  const missedStart = bond?.bound ? num(bond["start-height"]) : 0;

  const schedule = pool.schedule;
  if (!schedule) {
    return {
      show: true,
      kicker: missed === null ? "No bond" : "Awaiting a new bind",
      headline:
        missed === null ? "Nothing bound yet" : `Bond ${missed} started without the pool`,
      lead:
        missed === null
          ? `Deposits are closed until the operator binds a bond. Chain tip is burn ${fmt(burn)}.`
          : `Bond ${missed} started at burn ${fmt(missedStart)} without being staked, so it ` +
            `can no longer be joined. Deposits stay closed until the operator binds ` +
            `another. Chain tip is burn ${fmt(burn)}.`,
      rows: [],
    };
  }

  const { current, next } = schedule;
  const btc = (sats: number) => `${(sats / 1e8).toFixed(2)} BTC`;

  // A bond's membership is fixed before it opens: pox-5 only writes the
  // allowlist inside `setup-bond`, so nobody can be added to a running bond.
  // That is why a closed bond stays closed however much room is left in it.
  const closed = Boolean(current?.active);

  const allowlistNote =
    next.allowance === null ? ", once it has been set up with the pool allowlisted" : "";

  return {
    show: true,
    kicker:
      missed !== null ? "Awaiting a new bind" : closed ? "Closed to new members" : "No bond",
    headline:
      missed !== null
        ? `Bond ${missed} started without the pool`
        : closed
          ? `Bond ${current!.index} is running`
          : `Bond ${next.index} opens at ${fmt(next.start)}`,
    lead: missed !== null
      ? `Bond ${missed} was bound but started at burn ${fmt(missedStart)} without the pool ` +
        `staking into it, so it can no longer be joined -- bind-bond may replace it. ` +
        `The pool's next chance is bond ${next.index} at burn ${fmt(next.start)}, ` +
        `${relative(next.start, burn)}${allowlistNote}.`
      : closed
      ? `Bond ${current!.index} opened at burn ${fmt(current!.start)} and runs to ` +
        `${fmt(current!.unlock)}, ${relative(current!.unlock, burn)}. Its members were ` +
        `approved before it opened — pox-5 writes a bond's allowlist once, when the ` +
        `bond is set up, so no staker can be added to one that is already running. ` +
        `The pool's next chance is bond ${next.index} at burn ${fmt(next.start)}, ` +
        `${relative(next.start, burn)}${allowlistNote}.`
      : `Deposits are closed until the operator binds a bond. Bond ${next.index} ` +
        `opens at burn ${fmt(next.start)}, ${relative(next.start, burn)}.`,
    rows: [
      row("Chain tip", `burn ${fmt(burn)}`, "now", true),
      ...(missed !== null
        ? [
            row(
              `Bond ${missed} missed`,
              `started at burn ${fmt(missedStart)}`,
              relative(missedStart, burn),
              false,
            ),
          ]
        : []),
      ...(current
        ? [
            row(
              `Bond ${current.index} · cycle ${current.cycle}`,
              current.staked > 0 ? `${btc(current.staked)} staked` : "nothing staked",
              current.active ? "running" : "closed",
              current.active,
            ),
            row(
              `Bond ${current.index} term ends`,
              `burn ${fmt(current.unlock)}`,
              relative(current.unlock, burn),
              burn >= current.unlock,
            ),
          ]
        : []),
      row(
        `Bond ${next.index} opens`,
        `burn ${fmt(next.start)}`,
        relative(next.start, burn),
        burn >= next.start,
      ),
      row(
        `Pool allowlisted for bond ${next.index}`,
        next.allowance === null ? "not yet" : btc(next.allowance),
        next.allowance === null ? "needs setup-bond" : "ready to bind",
        next.allowance !== null,
      ),
    ],
  };
}

/// --- where the pool is in its own life --------------------------------------------

interface StagePill {
  label: string;
  bg: string;
  fg: string;
  dot: string;
}

/**
 * The badge above the headline, which is the first thing a reader sees and so
 * the first thing that can be out of date.
 *
 * The design drew it as "the genesis bond has not been staked" -- true only
 * until a bond is bound, and only ever true of bond 0. The pool has five
 * states and this says which one it is in, naming the bond it is actually
 * about.
 */
function stagePill(): StagePill {
  const live = { bg: "var(--color-accent-2-200)", fg: "var(--color-accent-2-800)", dot: "var(--color-accent-2-600)" };
  const past = { bg: "var(--color-neutral-300)", fg: "var(--color-neutral-800)", dot: "var(--color-neutral-500)" };

  const pool = state.pool;
  if (!pool) return { label: "Pre-launch · no contracts deployed on this network", ...live };

  if (pool.config?.finished === true) {
    return { label: "Wound down · the pool has unstaked for good", ...past };
  }

  if (pool.live) {
    const index = num(pool.live["bond-index"]);
    const unlock = num(pool.live["unlock-burn-height"]);
    return {
      label: `Staked · bond ${index}, term ends ${relative(unlock, pool.burn)}`,
      ...live,
    };
  }

  const bond = pool.bond;
  if (bond?.bound) {
    const index = num(bond["bond-index"]);
    const start = num(bond["start-height"]);
    // A bond that has started without the pool in it is not a stage the pool
    // can act on: `bind-bond` may replace it, so the badge says so plainly.
    return pool.burn < start
      ? {
          label: `Deposits open · bond ${index} starts ${relative(start, pool.burn)}`,
          ...live,
        }
      : { label: `Bond ${index} started unstaked · awaiting a new bind`, ...past };
  }

  return { label: "Pre-launch · no bond bound yet", ...live };
}

/// --- how full the pool is --------------------------------------------------------

interface LaunchPanel {
  title: string;
  lead: string;
  pct: string;
  /** The bar's own width, which is not the percentage below one part in fifty. */
  barW: string;
  gathered: string;
  target: string;
  note: string;
  hasNote: boolean;
  ctaShow: boolean;
  ctaLabel: string;
  /** Half the target: the point from which starting is worth it. */
  milestoneShow: boolean;
  milestoneReached: boolean;
  milestoneLabel: string;
  /** `stake`, which is permissionless -- offered once the milestone is past. */
  stakeShow: boolean;
  stakeReady: boolean;
  stakeLabel: string;
  stakeWait: string;
  stake: () => void;
}

/** Half the allocation: enough of a pool to be worth starting. */
const MILESTONE = 0.5;

/**
 * What has gathered against what the bond will take.
 *
 * `get-stake-preview` is the contract's own answer to "what would `stake` do
 * now", so the bar reads the same number the call would -- the queue plus the
 * committed position less those leaving, not just the queue.
 *
 * The target is the launch floor where there is one and the allocation where
 * there is not. Only the genesis bond may carry a floor: `bind-bond` refuses a
 * non-zero `min-sats` anywhere else, so every later bond fills against its
 * allocation and `stake` commits whatever turned up.
 */
function launchPanel(): LaunchPanel {
  const pool = state.pool;
  const bond = pool?.bond ?? null;
  const preview = pool?.preview ?? null;
  const btc = (sats: number) => `${(sats / 1e8).toFixed(4)} BTC`;
  const stx = (ustx: number) => `${(ustx / 1e6).toFixed(2)} STX`;

  const bound = Boolean(bond?.bound);
  const open = bound && (pool?.burn ?? 0) < num(bond!["start-height"]);

  // Nothing to read from: no deployment on this network. The rehearsal copy the
  // design shipped with stays, rather than a bar that reports a real zero.
  if (!pool || !bound) {
    return {
      title: "Launch floor",
      lead:
        "it runs the moment enough of a pool has gathered, and refuses below " +
        "the floor set for the genesis bond.",
      pct: "0%",
      barW: "0%",
      gathered: "0 sats gathered",
      target: "floor: half the allocation",
      note: "",
      hasNote: false,
      ctaShow: false,
      ctaLabel: "",
      milestoneShow: false,
      milestoneReached: false,
      milestoneLabel: "",
      stakeShow: false,
      stakeReady: false,
      stakeLabel: "",
      stakeWait: "",
      stake: () => {},
    };
  }

  const allocation = num(bond!["max-sats"]);
  const floorSats = preview ? num(preview["min-sats"]) : num(bond!["min-sats"]);
  const gathered = preview
    ? num(preview["eligible-sats"])
    : pool.totals
      ? num(pool.totals["queued-sats"])
      : 0;
  const target = floorSats > 0 ? floorSats : allocation;
  const share = target > 0 ? Math.min(gathered / target, 1) : 0;
  const percent = share * 100;

  const burn = pool.burn;
  const start = num(bond!["start-height"]);
  const opens = num(bond!["stake-opens-at"]);
  const notice = num(bond!["notice-ends-at"]);
  const reached = share >= MILESTONE;
  // A launch floor is a thing older vaults have. `bind-next-bond` takes no
  // `min-sats` and `get-stake-preview` stops reporting `meets-floor`, so a
  // missing answer means there is no floor to miss -- read as met, never as
  // failed, or the button would go dark against a vault that has no floor at
  // all.
  const meetsFloor = preview === null || preview["meets-floor"] !== false;
  // Everything `stake` itself checks, so the button is offered only when the
  // call would actually go through. The milestone is deliberately not among
  // them: the contract has no opinion about half an allocation, and gating the
  // button on one hid the call from a small pool that could stake perfectly
  // well -- which is how a bond gets missed.
  const stakeReady =
    burn >= opens &&
    burn >= notice &&
    burn < start &&
    Boolean(preview) &&
    num(preview!["sats"]) > 0 &&
    meetsFloor;

  const short = preview ? num(preview["short-ustx"]) : 0;
  const overAllocated = Boolean(preview?.["allocation-limited"]);
  const belowFloor = floorSats > 0 && !meetsFloor;

  return {
    title: floorSats > 0 ? "Launch floor" : "Filling the allocation",
    lead:
      floorSats > 0
        ? "it runs the moment enough of a pool has gathered, and refuses below " +
          `the ${btc(floorSats)} floor this bond was bound with.`
        : "it runs inside the window before the bond starts and commits whatever " +
          `has gathered, up to the ${btc(allocation)} pox-5 allows this pool on ` +
          `bond ${num(bond!["bond-index"])}.`,
    // A whole number reads as nothing at all below one per cent, which is
    // exactly where a pool starts, so keep a decimal until it is past that.
    pct:
      percent === 0
        ? "0%"
        : percent < 1
          ? `${percent.toFixed(2)}%`
          : `${Math.round(percent)}%`,
    // Anything non-zero gets a visible sliver: a bar that paints nothing for a
    // real deposit reads as a broken page rather than as a small number.
    barW: percent === 0 ? "0%" : `${Math.max(percent, 1.5)}%`,
    gathered: `${fmt(gathered)} sats gathered · ${btc(gathered)}`,
    target: floorSats > 0 ? `floor: ${btc(floorSats)}` : `allocation: ${btc(allocation)}`,
    note: short > 0
      ? `The STX leg is ${stx(short)} short of carrying all of it — a deposit-stx call tops it up.`
      : overAllocated
        ? "More has gathered than the allocation takes; the remainder is released at the roll."
        : belowFloor
          ? "Below the floor: `stake` refuses until it is met."
          : "",
    hasNote: short > 0 || overAllocated || belowFloor,
    ctaShow: open,
    ctaLabel: gathered > 0 ? "Add to the pool" : "Deposit sBTC",

    // The milestone is this page's, not the contract's: `stake` has no opinion
    // about half an allocation and never refuses over it. What it marks is the
    // point where starting beats waiting for a fuller pool -- advice about the
    // call, never a gate on it.
    milestoneShow: !pool.live,
    milestoneReached: reached,
    milestoneLabel: reached
      ? `Past half the allocation — the pool is worth starting`
      : `50% · ${btc(target * MILESTONE)} is the mark, not a floor`,
    stakeShow: !pool.live && burn < start,
    stakeReady,
    stakeLabel: "Stake the pool — open epoch 0",
    stakeWait: stakeReady
      ? ""
      : burn < opens
        ? `The stake window opens at burn ${fmt(opens)}, ${relative(opens, burn)}` +
          (notice > opens
            ? `, and the members' notice runs to burn ${fmt(notice)}, ${relative(notice, burn)}.`
            : ".")
        : burn < notice
          ? `The members' notice runs to burn ${fmt(notice)}, ${relative(notice, burn)}.`
          : "Nothing eligible to stake yet.",
    stake: () => void doStake(),
  };
}

/**
 * `stake`, from the page.
 *
 * The manager is whatever `get-config` reports, never a value typed here: the
 * contract compares it against the one it was initialized with and refuses
 * anything else, so reading it back is the only way to pass the right one.
 */
async function doStake(): Promise<void> {
  const manager = String(state.pool?.config?.["signer-manager"] ?? "");
  if (!manager) return setState({ notice: "The pool has no signer manager configured." });
  const api = await chainApi();
  await withWallet("the stake", () => api.poolCalls.stake(manager));
}

/// --- joining --------------------------------------------------------------------

const SALT_KEY = "esbee:salt";

const field = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";

const SATS_PER_BTC = 100_000_000;

/**
 * The field, in the contract's unit.
 *
 * sats is what every call takes and what every read returns; sBTC is only a
 * way of writing it that has fewer zeros to miscount. The conversion happens
 * here and nowhere else, so no call can be given the wrong one.
 */
const toSats = (value: string, unit: Unit): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return unit === "sats" ? Math.floor(n) : Math.round(n * SATS_PER_BTC);
};

/**
 * An amount said the way the member is currently reading them.
 *
 * The unit switch is not only about the field: a card that takes `0.5` and
 * then reports back `50,000,000 sats` has made the member do the conversion
 * themselves to check it is the number they meant.
 */
const written = (sats: number): string =>
  state.unit === "sats" ? `${fmt(sats)} sats` : `${fromSats(sats, "sbtc")} BTC`;

/** The same amount written for the field. Trailing zeros are noise. */
const fromSats = (sats: number, unit: Unit): string =>
  unit === "sats"
    ? String(sats)
    : (sats / SATS_PER_BTC).toFixed(8).replace(/\.?0+$/, "");

const satsField = (): number => toSats(field("join-sats"), state.unit);

/**
 * Change what the field is written in without changing what it says.
 *
 * Converting rather than clearing: the amount a member has already decided on
 * is the one thing a unit switch must not cost them.
 */
function switchUnit(unit: Unit): void {
  if (unit === state.unit) return;
  const sats = satsField();
  setState({ unit, amount: sats > 0 ? fromSats(sats, unit) : "" });
}

/** Put the whole balance in the field, and quote the STX it would need. */
/**
 * Put a whole balance in the field, and take the route that spends it.
 *
 * Pressing a balance is a statement about *which* of the two the member means
 * to pay with, not only about how much. Filling the field and leaving the
 * route on the other one would put the number they pressed under a flow that
 * cannot spend it.
 */
function useWholeBalance(route: Route): void {
  // Mid-route, a balance is a number to read rather than a button: pressing it
  // would change the amount, the route, or both, under a commitment that
  // already named them.
  if (l1Underway()) return setState({ notice: UNDERWAY_NOTICE });
  const sats =
    route === "l1" ? (state.btcBalance ?? 0) : (state.member?.sbtc ?? 0);
  if (sats <= 0) return setState({ route });
  setState({ route, amount: fromSats(sats, state.unit) });
  if (route === "l1") l1Armed = true;
  void quoteFor(sats);
  if (route === "l1") void loadL1();
}

/**
 * This member's past deposits, from what the bridge printed.
 *
 * On request, not on load: it is a scan of the contract's recent events, which
 * most visits have no use for.
 */
async function loadHistory(): Promise<void> {
  const member = state.account;
  if (!member || state.historyReading) return;
  setState({ historyReading: true });
  try {
    const api = await chainApi();
    setState({ history: await api.bridgeHistory(member), historyReading: false });
  } catch (error) {
    setState({
      historyReading: false,
      notice: `Could not read the deposit history: ${message(error)}`,
    });
  }
}

/** Quote the STX leg for an amount the member did not type. */
async function quoteFor(sats: number): Promise<void> {
  if (!configured() || sats <= 0) return;
  try {
    const api = await chainApi();
    setState({ quotedFor: sats, quotedUstx: Number(await api.quote(sats)) });
  } catch (error) {
    setState({ notice: `Could not quote the STX leg: ${message(error)}` });
  }
}

/** What a submitted deposit is doing, in the chain's own vocabulary. */
function pendingText(pending: Pending | null): string {
  if (!pending) return "";
  if (pending.status === "pending") {
    return "In the mempool. It joins the queue as soon as a block carries it — " +
      "you can close this page, it lands either way.";
  }
  if (pending.status === "success") {
    return "Confirmed. The deposit is queued, and withdrawable until the pool stakes.";
  }
  if (pending.status.startsWith("dropped")) {
    return "Dropped from the mempool before it confirmed. Nothing moved.";
  }
  if (pending.status === "abort_by_post_condition") {
    return "A post condition stopped it, so nothing moved. That is the check working.";
  }
  if (pending.status === "abort_by_response") {
    return "The contract rejected it and nothing moved.";
  }
  return `The chain reports: ${pending.status}.`;
}

/**
 * The salt has to survive between the commit and the reveal, and stay secret
 * until it. So it lives in this browser and nowhere else -- lose it before
 * revealing and the commitment can only be cancelled, not used.
 *
 * Keyed by the address now rather than by a txid: version 2 commits to where
 * the bitcoin will come *from*, which is a thing the member has before they
 * build anything.
 */
function saltFor(address: string): string {
  const key = `${SALT_KEY}:${address}`;
  const kept = localStorage.getItem(key);
  if (kept) return kept;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const salt = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(key, salt);
  return salt;
}

const known = (address: string): string | null =>
  localStorage.getItem(`${SALT_KEY}:${address}`);

/**
 * The deposit address this page derived, kept against the address it was for.
 *
 * It is a *derivation*, not a record: the same inputs rebuild it exactly. But
 * one of those inputs is the signers' current key, which rotates -- so an
 * address derived today and rebuilt after a rotation is a different address,
 * and the bitcoin went to the first one. Keeping it is how the card can still
 * say where a deposit went after a reload, rather than confidently showing an
 * address nothing was ever sent to.
 */
const TARGET_KEY = "esbee:deposit";
const SENT_KEY = "esbee:sent";

/**
 * The deposit transaction, kept against the address it came from.
 *
 * A txid is not something a member can be asked for twice: it is the one part
 * of this route the page cannot re-derive, and typing it into a field that a
 * re-render or a reload empties is how a deposit gets lost track of. So it is
 * written down the moment it is known, whether the page sent the bitcoin or
 * the member pasted it.
 */
function rememberSent(address: string, txid: string, vout: string): void {
  if (!address || !txid) return;
  try {
    localStorage.setItem(`${SENT_KEY}:${address}`, JSON.stringify({ txid, vout }));
  } catch {
    // Not fatal: the card keeps it until the page is closed.
  }
}

/** Forget it, for a member starting a second deposit from the same address. */
function forgetSent(address: string): void {
  try {
    localStorage.removeItem(`${SENT_KEY}:${address}`);
    localStorage.removeItem(`${TARGET_KEY}:${address}`);
  } catch {
    // Nothing to do: the reset below clears what the card is holding anyway.
  }
}

function rememberedSent(address: string): { txid: string; vout: string } | null {
  try {
    const kept = localStorage.getItem(`${SENT_KEY}:${address}`);
    if (!kept) return null;
    const sent = JSON.parse(kept) as { txid?: string; vout?: string };
    return sent?.txid ? { txid: sent.txid, vout: sent.vout ?? "0" } : null;
  } catch {
    return null;
  }
}

function rememberTarget(address: string, target: DepositTarget): void {
  if (!address) return;
  try {
    localStorage.setItem(`${TARGET_KEY}:${address}`, JSON.stringify(target));
  } catch {
    // A browser that will not keep it still completes the route; the address
    // stays on the card until the page is closed.
  }
}

function rememberedTarget(address: string): DepositTarget | null {
  try {
    const kept = localStorage.getItem(`${TARGET_KEY}:${address}`);
    if (!kept) return null;
    const target = JSON.parse(kept) as DepositTarget;
    return target?.address ? target : null;
  } catch {
    return null;
  }
}

/**
 * Run a wallet call and report it, returning the txid it produced.
 *
 * `openTab` is for the calls with nowhere else to show themselves. The deposit
 * has somewhere -- it watches the transaction in place -- and stealing focus to
 * a new tab on top of that is one thing too many.
 */
async function withWallet(
  label: string,
  run: () => Promise<string | null>,
  openTab = true,
): Promise<string | null> {
  if (!state.connected) {
    setState({ walletOpen: true });
    return null;
  }
  try {
    setState({ notice: `Confirm ${label} in your wallet…` });
    const txid = await run();
    setState({ notice: txid ? `${label} submitted — ${txid}` : `${label} submitted` });
    if (txid && openTab) window.open(explorerTx(txid), "_blank", "noopener");
    void refresh();
    return txid;
  } catch (error) {
    setState({ notice: `${label} failed: ${message(error)}` });
    return null;
  }
}

async function doDeposit(): Promise<void> {
  const sats = satsField();
  if (sats <= 0) return setState({ notice: "Enter an amount first." });
  const api = await chainApi();
  const ustx = Number(await api.quote(sats));
  const txid = await withWallet(
    "the deposit",
    () => api.poolCalls.deposit(sats, ustx),
    false,
  );
  // The field is only cleared once the wallet has come back with something.
  // A wallet that was dismissed, or a call that threw, leaves the amount where
  // the member typed it -- retyping it is the last thing they want to do.
  if (!txid) return;
  setState({ amount: "", quotedFor: 0, quotedUstx: 0, pending: { txid, status: "pending" } });
  watch(txid);
}

/// --- following a transaction -------------------------------------------------

/**
 * Watch a submitted transaction until it settles.
 *
 * The node pushes rather than being asked: `/extended/v1/ws` speaks JSON-RPC,
 * and one subscription costs nothing while it waits. Straight to Hiro and not
 * through the proxy -- that function forwards HTTP requests, and a socket is
 * not one. `poll` takes over if the socket cannot be had at all, which is the
 * case behind proxies that speak only HTTP.
 */
let socket: WebSocket | null = null;

function settle(txid: string, status: string): void {
  if (state.pending?.txid !== txid || state.pending.status === status) return;
  setState({ pending: { txid, status } });
  if (status === "pending") return;
  socket?.close();
  socket = null;
  // Whatever it did, the pool's numbers are now different from the ones on
  // screen -- including when it failed and they are the same again.
  void refresh();
}

function watch(txid: string): void {
  socket?.close();
  socket = null;
  try {
    const live = new WebSocket(`${net().api.replace(/^http/, "ws")}/extended/v1/ws`);
    socket = live;
    live.addEventListener("open", () =>
      live.send(
        JSON.stringify({
          jsonrpc: "2.0",
          // A number, because that is what the API's own client sends.
          id: 1,
          method: "subscribe",
          params: { event: "tx_update", tx_id: txid },
        }),
      ),
    );
    live.addEventListener("message", (event: MessageEvent) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          method?: string;
          params?: { tx_id?: string; tx_status?: string };
        };
        if (payload.method !== "tx_update") return;
        if (payload.params?.tx_id !== txid) return;
        settle(txid, String(payload.params.tx_status ?? "pending"));
      } catch {
        // Not a frame this cares about.
      }
    });
    live.addEventListener("error", () => void poll(txid));
    live.addEventListener("close", () => void poll(txid));
  } catch {
    void poll(txid);
  }
}

/** The fallback, and the reason a blocked socket is not a stuck spinner. */
let polling = "";
async function poll(txid: string): Promise<void> {
  if (polling === txid) return;
  polling = txid;
  try {
    for (let tries = 0; tries < 60; tries++) {
      if (state.pending?.txid !== txid || state.pending.status !== "pending") return;
      await new Promise((done) => setTimeout(done, 15_000));
      try {
        const response = await fetch(`${apiBase()}/extended/v1/tx/${txid}`);
        const body = (await response.json()) as { tx_status?: string };
        if (body.tx_status) settle(txid, body.tx_status);
      } catch {
        // A node that did not answer this time is asked again in fifteen.
      }
    }
  } finally {
    polling = "";
  }
}

/**
 * The bitcoin side, loaded only when a member works this card.
 *
 * @scure/btc-signer and the sBTC deposit builder are the heaviest thing the
 * site can load and the fewest visitors need them, so they sit behind their own
 * dynamic import -- the same trade `chain.ts` makes for the wallet SDK.
 */
type L1Module = typeof import("./l1.js");
let l1: L1Module | null = null;
const l1Api = async (): Promise<L1Module> => (l1 ??= await import("./l1.js"));

/**
 * What the wallet's bitcoin address holds on L1, in sats.
 *
 * A plain fetch rather than a call into `l1.ts`, deliberately: this is wanted
 * the moment a wallet connects, so that a member choosing between the two
 * routes can see both balances -- and reaching for the bitcoin module to read
 * one number would pull 210 kB into a connect that may never touch L1 at all.
 *
 * Silent on failure, and `null` rather than zero. This chain is one a public
 * explorer cannot see into, and "we could not look" and "you have nothing"
 * lead a member to opposite decisions.
 */
async function readBtcBalance(address: string): Promise<number | null> {
  const { api } = bitcoin();
  if (!api) return null;
  try {
    const response = await fetch(`${api}/address/${address}`);
    if (!response.ok) return null;
    const stats = (await response.json()) as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
      mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    };
    const net = (part?: { funded_txo_sum?: number; spent_txo_sum?: number }) =>
      (part?.funded_txo_sum ?? 0) - (part?.spent_txo_sum ?? 0);
    return net(stats.chain_stats) + net(stats.mempool_stats);
  } catch {
    return null;
  }
}

/**
 * The sats the route is already committed to, or null while it is still open.
 *
 * Past the commit the amount stops being the member's to change: it is mixed
 * into the digest that stands on chain, and every later step is checked
 * against it. So it is read back from the bridge rather than trusted to the
 * field, and the field is locked to what it says.
 */
const lockedSats = (): number | null => {
  const c = state.l1Chain;
  if (!c || c.credited) return null;
  return ourAnnouncement(c)?.sats ?? c.commitment?.sats ?? null;
};

/**
 * The announcement against this address, but only where it is this account's.
 *
 * An announcement is keyed by the funding script and nothing else, so the one
 * the bridge holds for an address may belong to anybody -- another member, or
 * this member's *other* account. Its sats go to whoever revealed it, and the
 * fields on this card exist to describe a route the person reading it is on.
 * Locking them to somebody else's numbers is worse than showing nothing: it
 * tells a member they are half-way through something they have not started,
 * and refuses to let them type their way out of it.
 *
 * The commitment needs no such test. `get-commitment` is keyed by
 * `(member, digest)`, so a commitment read back is already this account's.
 */
const ourAnnouncement = (c: L1Chain): L1Chain["announcement"] =>
  c.announcement && c.announcement.member === state.account ? c.announcement : null;

/** Somebody else got to this address first, and the bridge holds it for them. */
const takenByAnother = (c: L1Chain | null): string =>
  c && c.announcement && c.announcement.member !== state.account
    ? c.announcement.member
    : "";

/**
 * Whether an L1 route is part-way through, and so not a thing to change under.
 *
 * From the moment of the commit there is a hash on chain that mixed in this
 * amount, and a reveal and a deposit that will be checked against it. Pressing
 * a balance or the route switch would edit one half of that and leave the
 * other, which is not a smaller version of what the member meant -- it is a
 * route that no longer matches what they committed to. The way to change it is
 * the way out at the foot of the card, which the amount's own note names.
 */
const l1Underway = (): boolean => lockedSats() !== null;

/**
 * The STX that went with the committed sats, as the bridge recorded it.
 *
 * Read back rather than re-quoted, and the difference is not cosmetic: a quote
 * prices sats against whatever bond is bound *now*, and the pool may have
 * rolled since the commit. What the member paid is what the announcement says
 * they paid.
 */
const lockedUstx = (): number | null => {
  const c = state.l1Chain;
  if (!c || c.credited) return null;
  return ourAnnouncement(c)?.ustx ?? c.commitment?.ustx ?? null;
};

/**
 * The amount, in the contract's own unit.
 *
 * The same field as the sBTC route's: there is one amount on this card now,
 * because the STX leg is the same number either way -- `bond-bridge`'s
 * `get-required-ustx` calls straight through to the pool's -- so nothing about
 * the amount depends on which way it is paid.
 */
const btcSats = (): number => satsField();

/** The address typed into it, decoded, or null if it is not one. */
async function btcAddress(): Promise<{ text: string; pox: PoxAddress } | null> {
  const text = field("btc-address");
  if (!text) return null;
  const pox = (await l1Api()).readAddress(text);
  return pox ? { text, pox } : null;
}

/// --- where the member is on the L1 route ----------------------------------------

/** A decoded tuple, or null for the `none` a map-get returns. */
const tuple = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

/**
 * Whether this card's chain state is worth reading at all.
 *
 * Two ways in, and neither of them is "a wallet connected". Reading costs the
 * bitcoin bundle -- 210 kB, to decode one address -- and most members who
 * connect a wallet are here for the sBTC card or the vote floor.
 *
 *   the member has touched this card, so they are working the route;
 *   or a salt for the address in the field is in this browser, which only
 *   happens where this browser has already committed to it. That one is free
 *   to test, and it is the case where saying nothing would be worst: a
 *   commitment made yesterday is exactly what a member comes back for.
 */
let l1Armed = false;
let l1Reading = false;
const wantsL1 = (): boolean => {
  const at = state.btcAddress.trim();
  if (l1Armed) return true;
  if (at === "") return false;
  // A salt or a deposit kept against this address. Both are free to test, and
  // both mean this browser has already been down the route -- which is exactly
  // when a member comes back wanting to know where it got to.
  return known(at) !== null || rememberedSent(at) !== null;
};

/**
 * Read the route's state for the address in the field: the commitment, the
 * announcement, and whether the deposit named below has been credited.
 *
 * Fails soft on purpose. None of this is needed to work the route -- every
 * step checks itself before it spends anything -- so a node that does not
 * answer leaves the card as it was rather than replacing it with an error.
 */
async function loadL1(): Promise<void> {
  const member = state.account;
  if (!configured() || !member || l1Reading) return;
  const text = state.btcAddress.trim();
  if (!text) {
    if (state.l1Chain) setState({ l1Chain: null });
    return;
  }
  l1Reading = true;
  try {
    const pox = (await l1Api()).readAddress(text);
    if (!pox) {
      if (state.l1Chain) setState({ l1Chain: null });
      return;
    }
    const api = await chainApi();
    const salt = known(text);
    const digest = salt ? String(await api.addressDigest(pox, salt)) : "";
    // Read from what is kept as well as from what is in the field, and read it
    // *here* rather than restoring it alongside the results below. Restoring it
    // in the same `setState` as the reads meant the reads themselves still saw
    // an empty txid on the first load after a reload -- so a deposit that was
    // waiting to be swept came back as step 3, and the member was asked to
    // register a transaction the page already knew about.
    const kept = rememberedSent(text);
    const txid = state.btcTxid.trim() || kept?.txid || "";
    const vout = Number(state.btcVout || kept?.vout || "0");
    const readable = /^(0x)?[0-9a-f]{64}$/i.test(txid);
    const at = Number.isFinite(vout) ? vout : 0;
    const [commitment, announcement, credited, swept, burn] = await Promise.all([
      digest ? api.commitmentFor(member, digest) : null,
      api.announcementFor(pox),
      readable ? api.creditedDeposit(txid, at) : null,
      // Whether the signers have swept it, from the registry the bridge reads.
      // The difference between step 4 and step 5 is exactly this answer, and
      // the card used to infer it from "is there a txid" -- which is true the
      // moment the bitcoin is sent, hours before it is true of the sweep.
      readable ? api.sweptDeposit(txid, at) : null,
      api.burnHeight(),
    ]);
    const made = tuple(commitment);
    const revealed = tuple(announcement);
    const paid = tuple(credited);
    setState({
      l1Chain: {
        address: text,
        digest,
        salt: Boolean(salt),
        commitment: made
          ? {
              sats: num(made["sats"]),
              ustx: num(made["ustx"]),
              at: num(made["committed-at-height"]),
            }
          : null,
        announcement: revealed
          ? {
              member: String(revealed["member"] ?? ""),
              sats: num(revealed["sats"]),
              ustx: num(revealed["ustx"]),
              at: num(revealed["announced-at-height"]),
            }
          : null,
        credited: paid ? { sats: num(paid["sats"]) } : null,
        swept: Boolean(swept),
        txid: readable ? txid : "",
        burn,
      },
      // A route already under way beats an untouched picker. A member who
      // committed on a previous visit comes back to the flow they are in the
      // middle of, rather than to a choice they have already made.
      ...(state.route === "" && (made || revealed || paid)
        ? { route: "l1" as Route }
        : {}),
      // The amount is whatever was committed to, not whatever is in the field.
      // Written into state rather than only shown, so the quote, the deposit
      // and the register all read the same number the bridge does.
      ...(made || revealed
        ? {
            amount: fromSats(
              num((revealed ?? made)!["sats"]),
              state.unit,
            ),
          }
        : {}),
      // Where the bitcoin was told to go, from an earlier visit. Derived
      // afresh only when there is nothing kept: the signers' key rotates, and
      // a rebuild after a rotation is a different address than the one paid.
      ...(state.deposit === null && rememberedTarget(text)
        ? { deposit: rememberedTarget(text) }
        : {}),
      // ...and the deposit itself, which the member should never have to type
      // a second time. The reads above already used it; this is what puts it
      // back in the field they can see.
      ...(!state.btcTxid && kept
        ? { btcTxid: kept.txid, btcVout: kept.vout }
        : {}),
    });
    // Emily last, and separately: it answers for the stretch between the two
    // chain reads, and an Emily that cannot be reached must not cost the card
    // what the chain just told it.
    // The balance belongs to the address in the field, not to whichever one
    // the wallet led with at connect: a member who types another of their
    // addresses is asking about that one.
    if (onConfiguredChain(text)) {
      void readBtcBalance(text).then((sats) => {
        if (state.btcAddress.trim() === text) setState({ btcBalance: sats });
      });
    } else if (state.btcBalance !== null) {
      setState({ btcBalance: null });
    }

    const sent = state.btcTxid.trim() || rememberedSent(text)?.txid || "";
    if (/^(0x)?[0-9a-f]{64}$/i.test(sent)) {
      const at = Number(state.btcVout || "0");
      const said = await (await l1Api())
        .depositStatus(sent, Number.isFinite(at) ? at : 0)
        .catch(() => null);
      setState({
        emily: said?.status
          ? {
              status: said.status,
              message: said.statusMessage ?? "",
              lockTime: Number(
                (said as unknown as { parameters?: { lockTime?: number } }).parameters
                  ?.lockTime ?? 0,
              ),
            }
          : null,
      });
    }
  } catch {
    // Nothing here is load-bearing: the card keeps whatever it last knew.
  } finally {
    l1Reading = false;
  }
}

/**
 * Read it back as a submitted step lands.
 *
 * A commit that is in the mempool has not happened yet, so reading straight
 * after the wallet returns finds the state the member just left. Three looks
 * over the next couple of minutes cover a Stacks block without any of the
 * machinery the deposit watcher needs, and cost three read-only calls.
 */
function followL1(): void {
  l1Armed = true;
  for (const delay of [8_000, 30_000, 90_000]) setTimeout(() => void loadL1(), delay);
}

/**
 * Step 1: commit to the address the bitcoin will come from.
 *
 * The digest is the contract's own -- `get-address-digest` over the
 * scriptPubKey and the salt -- so a client cannot disagree with it about what
 * was committed to. Checking the script first turns "this bridge cannot take a
 * p2pk address" into a sentence rather than into a reverted reveal two blocks
 * later, when the STX leg has already been paid.
 */
async function doCommit(): Promise<void> {
  l1Armed = true;
  // Reads keyed on the member come before the wallet call now, so the wallet
  // has to be there before any of it rather than at the point of signing.
  if (!state.account) return setState({ walletOpen: true });
  const sats = btcSats();
  const address = await btcAddress();
  if (sats <= 0) return setState({ notice: "How many sats will you send?" });
  if (!address) {
    return setState({
      notice: "That is not a bitcoin address this page can read for this network.",
    });
  }
  const api = await chainApi();
  if (!(await api.addressScript(address.pox))) {
    return setState({
      notice: "The bridge cannot take that address shape. A p2wpkh or p2tr address will do.",
    });
  }
  const salt = saltFor(address.text);
  const digest = String(await api.addressDigest(address.pox, salt));
  // A second commit to the same address is `ERR_COMMITMENT_EXISTS`, and the
  // digest does not carry the amount -- so a member changing their mind about
  // how much to send finds their old commitment in the way rather than a new
  // one made. Cancelling is theirs to do at any time; only a stranger has to
  // wait out the TTL.
  const existing = (await api.commitmentFor(state.account!, digest)) as Record<
    string,
    unknown
  > | null;
  if (existing) {
    const already = num(existing["sats"]);
    return setState({
      notice:
        `That address is already committed here, for ${fmt(already)} sats. ` +
        (already === sats
          ? "Reveal it — step 2."
          : "Cancel it first if you mean to send a different amount, then commit again."),
    });
  }
  const ustx = Number(await api.bridgeQuote(sats));
  const txid = await withWallet("the commitment", () =>
    api.bridgeCalls.commitAddress(digest, sats, ustx),
  );
  if (txid) {
    // A new commitment starts a new route: whatever deposit was remembered
    // against this address belonged to the last one -- including the address
    // it was told to pay, which was derived for the *old* amount and would
    // otherwise keep announcing that amount under the new commitment.
    forgetSent(address.text);
    setState({ btcTxid: "", btcVout: "0", deposit: null, emily: null });
    setValue("btc-txid", "");
    followL1();
    setState({
      notice:
        `Committed. The reveal opens one bitcoin block later — ${shortWait(1)} — ` +
        `and step 2 says so if it is asked sooner.`,
    });
  }
}

/**
 * Step 2: name it, one burn block later. First reveal takes the address.
 *
 * The wait is a bitcoin block, not a Stacks one, and the difference is the
 * whole point: a reveal in the same burn block as its commit is behind no
 * commitment anybody could have raced, so the contract refuses it
 * (`ERR_REVEAL_TOO_SOON`). Refused on chain means the transaction confirms,
 * costs a fee and does nothing -- which is a poor way to learn about a wait, so
 * the commitment is read first and the arithmetic is done here.
 */
async function doReveal(): Promise<void> {
  l1Armed = true;
  if (!state.account) return setState({ walletOpen: true });
  const address = await btcAddress();
  if (!address) return setState({ notice: "Which address did you commit to?" });
  const salt = known(address.text);
  if (!salt) {
    return setState({
      notice: "No salt stored here for that address — commit again from this browser.",
    });
  }
  const api = await chainApi();
  const digest = String(await api.addressDigest(address.pox, salt));
  const [commitment, burn] = await Promise.all([
    api.commitmentFor(state.account!, digest),
    api.burnHeight(),
  ]);
  if (!commitment) {
    const announced = await api.announcementFor(address.pox);
    return setState({
      notice: announced
        ? "That address is already revealed — go on to the deposit."
        : "No commitment on chain for that address. Commit it first, or it lapsed.",
    });
  }
  const opensAt = num((commitment as Record<string, unknown>)["committed-at-height"]) + 1;
  const blocks = opensAt - burn;
  if (burn < opensAt) {
    return setState({
      notice:
        `The reveal opens at burn height ${fmt(opensAt)} and the chain is at ` +
        `${fmt(burn)} — ${blocks === 1 ? "one bitcoin block" : `${fmt(blocks)} bitcoin blocks`}, ` +
        `so ${shortWait(blocks)}. Revealing now would be refused on chain and ` +
        `cost you the fee.`,
    });
  }
  await withWallet("the reveal", () => api.bridgeCalls.revealAddress(address.pox, salt));
  followL1();
}

/**
 * Where the bitcoin has to go: an sBTC deposit address for the treasury.
 *
 * Derived rather than looked up. `get-deposit-address` names the *principal*
 * the signers must credit; the bitcoin address that makes them credit it is a
 * one-off taproot output whose script tree holds that principal, the signers'
 * current key, and a reclaim path belonging to this member. All three come from
 * somewhere authoritative -- the bridge, the sBTC registry, and the wallet.
 *
 * The wallet is asked for one address in particular: the one this deposit is
 * about. A reclaim path is a key, and a bech32 address carries a hash rather
 * than a key, so it cannot be read off the address the member revealed -- but
 * it has to be *that* address's key, or the reclaim leaf belongs to an account
 * the bitcoin never came from.
 */
async function depositTarget(sats: number): Promise<DepositTarget> {
  const [api, bitcoinSide] = await Promise.all([chainApi(), l1Api()]);
  const from = (await btcAddress())?.text;
  const account = await api.bitcoinAccount(from);
  if (!account?.publicKey) {
    throw new Error(
      "The wallet did not hand over a bitcoin public key, and the reclaim path " +
        "of a deposit address is built from one.",
    );
  }
  const [recipient, signers] = await Promise.all([
    api.depositRecipient(),
    bitcoinSide.signersPublicKey(api.readOnly),
  ]);
  const built = bitcoinSide.depositAddress({
    recipient: String(recipient),
    signersPublicKey: signers,
    reclaimPublicKey: bitcoinSide.xOnly(account.publicKey),
  });
  const target = { ...built, sats };
  rememberTarget(from ?? "", target);
  setState({ deposit: target });
  return target;
}

/**
 * Tell the sBTC signers a deposit exists.
 *
 * Not a formality: they do not watch bitcoin for deposits, they are told about
 * them. Bitcoin sent to a deposit address nobody registered is swept by nobody
 * and sits there until its reclaim path opens, ~950 blocks later.
 */
async function register(target: DepositTarget, txid: string): Promise<number> {
  const bitcoinSide = await l1Api();
  const vout = await bitcoinSide.outputIndex(txid, target.address);
  const raw = await bitcoinSide.rawTx(txid);
  await bitcoinSide.notify({
    txid,
    vout,
    depositScript: target.depositScript,
    reclaimScript: target.reclaimScript,
    raw,
  });
  return vout;
}

/**
 * Step 3: send the bitcoin, and register it.
 *
 * Three things in a row, and they are kept apart on purpose, because the
 * bitcoin moves in the middle of them. Once the wallet has sent, nothing that
 * happens afterwards should read as "the deposit failed" -- the sats are on
 * bitcoin either way, at an address this page can still show, and what is left
 * is telling the signers about them. So each stage reports itself, and the two
 * after the send say what is true of the money rather than of the step.
 */
async function doDepositBtc(): Promise<void> {
  l1Armed = true;
  if (!state.account) return setState({ walletOpen: true });
  const sats = btcSats();
  if (sats <= 0) return setState({ notice: "How many sats are you sending?" });

  let target: DepositTarget;
  try {
    setState({ notice: "Deriving the deposit address…" });
    target = await depositTarget(sats);
  } catch (error) {
    return setState({ notice: `Could not derive the deposit address: ${message(error)}` });
  }

  let txid: string | null;
  try {
    setState({ notice: `Confirm the deposit to ${target.address} in your wallet…` });
    const api = await chainApi();
    txid = await api.sendBitcoin(target.address, sats);
  } catch (error) {
    // The address is on the card by now, derived a moment ago. A wallet that
    // cannot reach this bitcoin -- or a member who would rather send from
    // somewhere else -- has everything they need to pay it by hand.
    return setState({
      notice:
        `The wallet did not send it: ${message(error)}. The deposit address is on ` +
        `the card if you would rather pay it yourself.`,
    });
  }
  if (!txid) return setState({ notice: "The wallet returned no transaction id." });
  setValue("btc-txid", txid);
  rememberSent(target ? (await btcAddress())?.text ?? "" : "", txid, state.btcVout || "0");

  // Past here the bitcoin has moved.
  if (!bitcoin().configured) {
    return setState({
      notice:
        `Sent — ${txid}. Nothing has told the sBTC signers about it: this page ` +
        `has no deposit API configured for ${config.network}, and an unregistered ` +
        `deposit is not swept. The address it went to is on the card; register it ` +
        `there, or reload with ?btcApi= and ?emily= and press Register.`,
    });
  }
  try {
    setState({ notice: "Sent. Telling the sBTC signers about it…" });
    // The transaction has to be readable before it can be registered, and a
    // send that has only just left the wallet may not have reached the API yet.
    const vout = await retry(() => register(target, txid!));
    setValue("btc-vout", String(vout));
    setState({
      notice: "Registered. The signers sweep it in their own time; step 5 credits it when they have.",
    });
  } catch (error) {
    setState({
      notice:
        `Sent — ${txid} — but registering it failed: ${message(error)}. The bitcoin ` +
        `is at the deposit address on the card and nothing is lost; press Register ` +
        `to try again, and if this page's bitcoin API cannot see this chain at all, ` +
        `reload with ?btcApi= pointed at one that can before you do.`,
    });
  }
}

/**
 * Show where the bitcoin has to go, without sending any.
 *
 * The address does not depend on the amount -- it commits to the recipient, the
 * signers' key and the member's reclaim path, and nothing else -- so it can be
 * shown before an amount has been decided, and paid from anywhere. Which is the
 * point: a member with a hardware wallet, or one whose wallet cannot reach this
 * bitcoin, needs the address rather than a button that spends for them.
 */
async function doShowDeposit(): Promise<void> {
  l1Armed = true;
  if (!state.account) return setState({ walletOpen: true });
  try {
    setState({ notice: "Deriving the deposit address…" });
    const target = await depositTarget(btcSats());
    setState({
      notice: `Pay ${target.address} from the address you revealed, then press Register.`,
    });
  } catch (error) {
    setState({ notice: `Could not derive the deposit address: ${message(error)}` });
  }
}

/** The same registration, for bitcoin sent from somewhere this page cannot drive. */
async function doRegister(): Promise<void> {
  l1Armed = true;
  const txid = field("btc-txid");
  const sats = btcSats();
  if (!txid) return setState({ notice: "Which txid?" });
  try {
    const target = state.deposit ?? (await depositTarget(sats));
    const vout = await register(target, txid);
    setValue("btc-vout", String(vout));
    rememberSent((await btcAddress())?.text ?? "", txid, String(vout));
    void loadL1();
    setState({ notice: "Registered with the sBTC signers." });
  } catch (error) {
    setState({ notice: `Could not register it: ${message(error)}` });
  }
}

/**
 * Step 5: credit the member, with the proof of whose bitcoin it was.
 *
 * The transaction and the transaction behind each of its inputs, fetched here
 * rather than typed: the chain of txids is what the contract checks, and no
 * member is going to paste eight raw transactions by hand.
 */
async function doComplete(): Promise<void> {
  l1Armed = true;
  const txid = field("btc-txid");
  const vout = Number(field("btc-vout") || 0);
  if (!txid) return setState({ notice: "Which txid?" });
  try {
    // The signers have to have swept it first. The bridge reads the sBTC
    // registry for that and returns u304 when it finds nothing, so the same
    // read here turns a transaction that reverts -- signed, broadcast, paid
    // for -- into a sentence. Emily is asked second, for what the registry
    // cannot say: not *whether* it has been swept but how far off it is.
    setState({ notice: "Checking whether the signers have swept it…" });
    const chain = await chainApi();
    const vout0 = Number.isFinite(vout) ? vout : 0;
    if (!(await chain.sweptDeposit(txid, vout0))) {
      const emily = await (await l1Api()).depositStatus(txid, vout0).catch(() => null);
      const said = emily?.status
        ? `Emily has it as ${emily.status.toLowerCase()}` +
          (emily.statusMessage ? ` — ${emily.statusMessage}` : "")
        : bitcoin().emily
          ? "Emily has no record of it, so it may never have been registered — " +
            "press Register a deposit I sent"
          : "and this page has no Emily configured to ask";
      return setState({
        notice:
          `Not swept yet, so there is nothing to credit: the sBTC registry has ` +
          `no completed deposit for that txid. ${said}. The signers sweep in ` +
          `their own time; step 5 works the moment they have.`,
      });
    }

    setState({ notice: "Reading the deposit back from bitcoin…" });
    const bitcoinSide = await l1Api();
    const raw = await bitcoinSide.rawTx(txid);
    const parents = await bitcoinSide.parents(raw);
    const api = chain;
    // The STX leg this will move, read from the announcement it belongs to, so
    // the call can name it rather than permit anything. Unreadable is not a
    // reason to refuse: the sats are already swept and a deposit nobody
    // completes is a deposit nobody can get back.
    const address = await btcAddress();
    const announced = address ? tuple(await api.announcementFor(address.pox)) : null;
    await withWallet("the credit", () =>
      api.bridgeCalls.complete(
        txid,
        vout,
        raw,
        parents,
        announced ? num(announced["ustx"]) : undefined,
      ),
    );
    followL1();
  } catch (error) {
    setState({ notice: `Could not complete it: ${message(error)}` });
  }
}

/** Take the STX leg back from a commitment or an announcement that lapsed. */
async function doCancelL1(): Promise<void> {
  l1Armed = true;
  const address = await btcAddress();
  const api = await chainApi();
  if (address) {
    const salt = known(address.text);
    const announced = tuple(await api.announcementFor(address.pox));
    // Only this account's. An announcement is keyed by the funding script, so
    // the one standing against an address may be somebody else's -- and
    // `cancel-btc-deposit` refuses a live announcement from anyone but the
    // member who made it. Falling through to the commitment is what the member
    // actually wants there: their own STX leg back.
    if (announced && String(announced["member"] ?? "") === state.account) {
      await withWallet("the cancellation", () =>
        api.bridgeCalls.cancelDeposit(address.pox),
      );
      return endRoute(address.text);
    }
    if (salt) {
      const digest = String(await api.addressDigest(address.pox, salt));
      await withWallet("the cancellation", () =>
        api.bridgeCalls.cancelCommitment(state.account!, digest),
      );
      return endRoute(address.text);
    }
  }
  setState({ notice: "Nothing here to cancel for that address." });
}

/**
 * Put the route down, leaving nothing of it attached to the next one.
 *
 * The deposit this browser remembers belongs to the commitment it was made
 * under. Left in place across a cancel it becomes the *new* route's reason to
 * wait -- a card saying it is waiting on a transaction that has nothing to do
 * with the commitment now standing. The bitcoin itself is untouched by any of
 * this: it is with the sBTC signers either way, and the deposits card still
 * lists it.
 */
function endRoute(address: string): void {
  forgetSent(address);
  setState({ btcTxid: "", btcVout: "0", deposit: null, emily: null, review: null });
  setValue("btc-txid", "");
  followL1();
}

/**
 * Write into an uncontrolled field the way a member would have.
 *
 * And hold it in state, which is what `hold()` does for a field the member
 * types into. Without that, a txid written here by step 3 was gone at the next
 * re-render -- the template's `value` puts back what state has -- taking with
 * it the one thing step 5 needs.
 */
function setValue(id: string, value: string): void {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (input) input.value = value;
  if (id === "btc-txid") state.btcTxid = value;
  else if (id === "btc-vout") state.btcVout = value;
  else if (id === "btc-address") state.btcAddress = value;
  else if (id === "join-sats") state.amount = value;
}

/** Try something a few times, for a bitcoin API that has not caught up yet. */
async function retry<T>(run: () => Promise<T>, tries = 6): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      await new Promise((done) => setTimeout(done, 5_000));
    }
  }
  throw last;
}

/// --- the testnet faucets ----------------------------------------------------------

type FaucetKind = "stx" | "sbtc" | "btc";

const FAUCET_LABEL: Record<FaucetKind, string> = { stx: "STX", sbtc: "sBTC", btc: "BTC" };

/**
 * Every leg, from Hiro's testnet faucets.
 *
 * A deposit needs sBTC *and* the STX the bond prices it at, so a reader who has
 * only ever held one of them cannot join; the L1 route needs bitcoin instead of
 * the sBTC. The faucet builds and broadcasts its own transaction -- there is
 * nothing to sign here, which is why this needs no wallet SDK, only an address.
 *
 * Which address is not the same question for all three. `stx` and `sbtc` pay
 * the Stacks account; `btc` pays a *bitcoin* address, and the one that matters
 * is the address the L1 card is about -- the bitcoin has to be spent from the
 * address the commitment names, so dripping it anywhere else is no use.
 *
 * Testnet only, because there is no such thing on mainnet. `config.network`
 * gates the buttons rather than this function, so the failure a reader can see
 * is a missing button and not a call that always says no.
 */
async function faucet(kind: FaucetKind): Promise<void> {
  const label = FAUCET_LABEL[kind];
  const address =
    kind === "btc" ? (field("btc-address") || state.btcAddress).trim() : state.account;
  if (!address) {
    return kind === "btc"
      ? setState({
          notice: "Put the bitcoin address you want paid in the field above first.",
        })
      : setState({ walletOpen: true });
  }

  // A faucet pays whatever address it is given. Hiro's is testnet's, so a
  // mainnet address here is a request that can only fail -- and one the member
  // could not have spent from anyway, since the commitment is about this chain.
  if (kind === "btc" && !onConfiguredChain(address)) {
    return setState({
      notice:
        `${address} is not a ${bitcoin().chain} bitcoin address, and the faucet ` +
        `only pays ${bitcoin().chain} — it answers anything else with "Invalid BTC ` +
        `${bitcoin().chain} address". One like ${addressExample()} is what it wants. ` +
        walletNetworkAdvice(),
    });
  }

  const query = new URLSearchParams({ address });
  // The ordinary bitcoin drip is a few thousand sats, which is below anything a
  // bond will take. `xlarge` is the one worth pressing, so it is the one the
  // button presses -- a faucet run that cannot fund a deposit is a wasted wait.
  if (kind === "btc") query.set("xlarge", "true");

  setState({ notice: `Asking the ${label} faucet…` });
  try {
    const response = await fetch(
      `${net().api}/extended/v1/faucets/${kind}?${query.toString()}`,
      {
        method: "POST",
        // The Stacks faucets take the address in the body as well; the bitcoin
        // one takes the query string alone, and is given nothing to disagree
        // with itself about.
        ...(kind === "btc"
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ address }),
            }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      txId?: string;
      txid?: string;
      error?: string;
    };
    // 429 is the one to expect: the faucet allows an address a request every
    // few minutes, and says so itself. Pass its own words through.
    if (!response.ok || body.success === false) {
      throw new Error(body.error ?? `it answered ${response.status}`);
    }
    // Two spellings, because the bitcoin faucet does not use the Stacks one.
    const txid = body.txId ?? body.txid;
    setState({
      notice: txid ? `${label} on the way — ${txid}` : `${label} on the way`,
      // The notice bar is text; a bitcoin txid is worth following, and only
      // the card can carry a link. Stacks faucets are left to the bar, since
      // their transactions show up in the pending row already.
      ...(kind === "btc" && txid ? { btcFaucetTx: txid } : {}),
    });
    // A faucet transaction is an ordinary transaction: the balance moves when
    // it confirms, not when the request returns. Bitcoin takes rather longer
    // than a Stacks block, and nothing on this page reads a bitcoin balance
    // anyway -- so only the Stacks legs are worth re-reading for.
    if (kind !== "btc") window.setTimeout(() => void refresh(), 30_000);
  } catch (error) {
    setState({ notice: `The ${label} faucet said no: ${message(error)}` });
  }
}

/**
 * Whether the connected address belongs to the network the page is on.
 *
 * The same one-character test `chain.ts` makes before it will sign anything --
 * repeated here rather than imported because this module must not pull the
 * chain layer in, and the answer decides what a reader is shown, not what is
 * sent. `chain.ts` remains the one that refuses.
 */
const walletMatchesNetwork = (address: string): boolean =>
  /^S[PM]/.test(address) === (config.network === "mainnet");

const poolAction = (label: string, pick: (api: Awaited<ReturnType<typeof chainApi>>) => Promise<string | null>) =>
  () => void withWallet(label, async () => pick(await chainApi()));

interface JoinPanel {
  open: boolean;
  closed: boolean;
  connected: boolean;
  /** No wallet: the balance row offers to connect rather than reading "—". */
  disconnected: boolean;
  connect: () => void;
  closedWhy: string;
  quote: string;
  balance: string;
  /** Committed to, and so no longer the field's to change. */
  amountLocked: boolean;
  amountLockNote: string;
  /** What the wallet holds on L1, beside what it holds in sBTC. */
  btcBalance: string;
  btcBalanceNote: string;
  /** Which way in the member has chosen, and what that shows. */
  route: string;
  sbtcRoute: boolean;
  l1Route: boolean;
  chosen: boolean;
  unchosen: boolean;
  sbtcPickBg: string;
  sbtcPickFg: string;
  l1PickBg: string;
  l1PickFg: string;
  pickSbtc: () => void;
  pickL1: () => void;
  /** A deposit is part-way through, so the route and the amount are settled. */
  underway: boolean;
  underwayNote: string;
  pickCursor: string;
  queuedSats: string;
  queuedUstx: string;
  committed: string;
  releasedSats: string;
  rewards: string;
  hasQueued: boolean;
  hasReleased: boolean;
  hasRewards: boolean;
  deposit: () => void;
  withdraw: () => void;
  claimPrincipal: () => void;
  claimRewards: () => void;
  /** The amount field: what it is written in, and what is in it. */
  amount: string;
  amountLabel: string;
  placeholder: string;
  satsFg: string;
  satsLine: string;
  sbtcFg: string;
  sbtcLine: string;
  showSats: () => void;
  showSbtc: () => void;
  useMax: () => void;
  useBtcMax: () => void;
  maxHint: string;
  btcMaxHint: string;
  /** A submitted deposit, followed until the chain settles it. */
  pendingShow: boolean;
  pendingText: string;
  pendingTxid: string;
  pendingLink: string;
  /** The wallet is on another chain: nothing here would send. */
  wrongNetwork: boolean;
  networkWarning: string;
  /** Testnet only: both legs are a click away, so a reader can actually join. */
  faucets: boolean;
  faucetStx: () => void;
  faucetSbtc: () => void;
}

function joinPanel(): JoinPanel {
  const bond = state.pool?.bond ?? null;
  const burn = state.pool?.burn ?? 0;
  const open = Boolean(bond?.bound) && burn < num(bond?.["start-height"] ?? 0);
  const m = state.member;
  const settled = m?.settled ?? null;

  const btc = (sats: number) => `${(sats / 1e8).toFixed(4)} BTC`;
  const stx = (ustx: number) => `${(ustx / 1e6).toFixed(2)} STX`;

  const queuedSats = settled ? num(settled["queued-sats"]) : 0;
  const releasedSats = m?.principal ? num(m.principal["released-sats"]) : 0;
  const mismatched = Boolean(state.account) && !walletMatchesNetwork(state.account!);

  return {
    open,
    closed: !open,
    connected: state.connected,
    disconnected: !state.connected,
    connect: () => setState({ walletOpen: true }),
    closedWhy: !configured()
      ? "This page has no deployment configured, so nothing here would be sent."
      : !bond?.bound
        ? "Deposits open when the operator binds a bond. Nothing is locked meanwhile."
        : "This bond has started; the next window opens when the pool binds again.",
    // A committed route arrives with both legs already settled, so the line
    // says them rather than waiting to be typed into. Without this, a member
    // returning to a deposit made yesterday was told to "enter an amount"
    // beside an amount field they are not allowed to type in.
    quote:
      lockedSats() !== null
        ? `${written(lockedSats()!)} needs ${stx(lockedUstx() ?? 0)}`
        : state.quotedFor > 0
          ? `${fmt(state.quotedFor)} sats needs ${stx(state.quotedUstx)}`
          : "enter an amount",
    balance: m ? btc(m.sbtc) : "—",
    // Past the commit the amount is the bridge's, not the field's. Said in
    // words as well as locked, and the way to change it named: there is one,
    // and it is not editing this.
    amountLocked: lockedSats() !== null,
    amountLockNote:
      `This is the amount you committed to — it is mixed into the hash that ` +
      `stands on chain, so it can no longer be edited. To send a different ` +
      `amount, give up this commitment at the bottom of the card and commit ` +
      `again; the STX leg comes back to you either way.`,
    // Both balances, before the choice. Which route a member can take is
    // mostly a question of which of the two they are holding, and the old
    // pair of cards asked them to pick before showing either.
    btcBalance:
      state.btcBalance === null ? "—" : btc(state.btcBalance),
    btcBalanceNote:
      state.btcBalance === null
        ? state.btcAddress
          ? "not readable from here"
          : "connect to see it"
        : "",
    // The choice itself, and what it reveals. A route already under way wins
    // over an untouched picker: a member with a commitment on chain is on the
    // L1 route whether or not they pressed the button this visit.
    route: state.route,
    sbtcRoute: state.route === "sbtc",
    l1Route: state.route === "l1",
    chosen: state.route !== "",
    unchosen: state.route === "",
    // A segmented choice rather than two buttons: the two are alternatives to
    // each other, not two things to do, and a pair of buttons says the latter.
    sbtcPickBg: state.route === "sbtc" ? "var(--color-accent)" : "transparent",
    sbtcPickFg:
      state.route === "sbtc" ? "var(--color-bg)" : "var(--color-neutral-800)",
    l1PickBg: state.route === "l1" ? "var(--color-accent)" : "transparent",
    l1PickFg: state.route === "l1" ? "var(--color-bg)" : "var(--color-neutral-800)",
    pickSbtc: () =>
      setState(l1Underway() ? { notice: UNDERWAY_NOTICE } : { route: "sbtc" }),
    pickL1: () => {
      l1Armed = true;
      setState({ route: "l1" });
      void loadL1();
    },
    // Said once, and worn by everything the route has taken out of the
    // member's hands: the switch, both balances and the amount field.
    underway: l1Underway(),
    underwayNote: UNDERWAY_NOTICE,
    pickCursor: l1Underway() ? "default" : "pointer",
    queuedSats: btc(queuedSats),
    queuedUstx: settled ? stx(num(settled["queued-ustx"])) : "0.00 STX",
    committed: settled ? btc(num(settled["bonded-sats"])) : "0.0000 BTC",
    releasedSats: btc(releasedSats),
    rewards: btc(m?.rewards ?? 0),
    hasQueued: queuedSats > 0,
    hasReleased: releasedSats > 0,
    hasRewards: (m?.rewards ?? 0) > 0,
    amount: state.amount,
    // BTC rather than sBTC, whichever route is taken: the amount is bitcoin
    // either way, and sBTC is what it is wearing on this side of the bridge.
    amountLabel: state.unit === "sats" ? "Amount in sats" : "Amount in BTC",
    placeholder: state.unit === "sats" ? "10000000" : "0.1",
    // A quiet pair of words rather than a control: which unit the field is in
    // matters, but not as much as anything else on this card.
    satsFg: state.unit === "sats" ? "var(--color-text)" : "var(--color-neutral-700)",
    satsLine: state.unit === "sats" ? "underline" : "none",
    sbtcFg: state.unit === "sbtc" ? "var(--color-text)" : "var(--color-neutral-700)",
    sbtcLine: state.unit === "sbtc" ? "underline" : "none",
    showSats: () => switchUnit("sats"),
    showSbtc: () => switchUnit("sbtc"),
    useMax: () => useWholeBalance("sbtc"),
    useBtcMax: () => useWholeBalance("l1"),
    // Only worth offering where there is something to spend and the amount is
    // still the member's to set.
    btcMaxHint:
      (state.btcBalance ?? 0) > 0 && lockedSats() === null
        ? "Put all of it in the amount, and pay with L1 bitcoin"
        : "Nothing here to spend",
    maxHint:
      (m?.sbtc ?? 0) > 0
        ? "Put all of it in the amount, and pay with sBTC"
        : "Nothing here to spend",
    pendingShow: Boolean(state.pending),
    pendingText: pendingText(state.pending),
    pendingTxid: state.pending ? shorten(state.pending.txid) : "",
    pendingLink: state.pending ? explorerTx(state.pending.txid) : "",
    deposit: () => void doDeposit(),
    withdraw: poolAction("the withdrawal", (api) => api.poolCalls.withdraw()),
    claimPrincipal: poolAction("the claim", (api) =>
      api.poolCalls.claimPrincipal(state.account!),
    ),
    claimRewards: poolAction("the claim", (api) =>
      api.poolCalls.claimRewards(state.account!),
    ),
    wrongNetwork: mismatched,
    networkWarning: mismatched
      ? `Your wallet is a ${/^S[PM]/.test(state.account!) ? "mainnet" : "testnet"} ` +
        `address and this page is on ${config.network}. Switch the wallet's network ` +
        `and reconnect — nothing here would reach ${config.network} otherwise.`
      : "",
    // An address, not just a connection: the rehearsal connects without one,
    // and the faucet has nowhere to send to. A mainnet address is no use to a
    // testnet faucet either.
    // Shown to a reader who has not connected yet, which is most of the point
    // of a faucet row: `faucet()` opens the wallet dialog for the two legs
    // that pay a Stacks account, and the bitcoin one pays whatever address is
    // in the field. Hidden only where the wallet is on the wrong chain, since
    // there every one of them would be a request that cannot succeed.
    faucets: config.network === "testnet" && !mismatched,
    faucetStx: () => void faucet("stx"),
    faucetSbtc: () => void faucet("sbtc"),
  };
}

/// --- the L1 route ------------------------------------------------------------

interface L1Panel {
  /** The principal an sBTC deposit has to credit. */
  recipient: string;
  quote: string;
  /** The address the bitcoin will come from, prefilled from the wallet. */
  address: string;
  addressPlaceholder: string;
  addressNote: string;
  /** Committed to, and so no longer the field's to change. */
  addressLocked: boolean;
  /** The wallet is on another bitcoin than this deployment: step 3 cannot run. */
  walletWrongShow: boolean;
  walletWrongNote: string;
  /** The wallet's own address, offered beside a field that already has one. */
  suggestShow: boolean;
  suggestNote: string;
  suggestAddress: string;
  useWallet: () => void;
  commit: () => void;
  reveal: () => void;
  deposit: () => void;
  register: () => void;
  complete: () => void;
  cancel: () => void;
  cancelWhen: string;
  /** What the sBTC signers say they are doing with the deposit. */
  emilyShow: boolean;
  emilyStatus: string;
  emilyTone: string;
  emilyNote: string;
  checkStatus: () => void;
  /** The address, in the two scripts it is built from, for checking. */
  proofShow: boolean;
  proofDeposit: string;
  proofReclaim: string;
  copyDeposit: () => void;
  copyReclaim: () => void;
  proofReclaimNote: string;
  proofParams: { name: string; value: string }[];
  /** The deposit is credited: the route is finished and can be run again. */
  doneShow: boolean;
  startAgain: () => void;
  /** What this member has done on the bridge before. */
  historyShow: boolean;
  historyEmpty: boolean;
  historyLabel: string;
  historyNote: string;
  history: {
    what: string;
    amount: string;
    txid: string;
    txidShow: boolean;
    txidLink: string;
    stacksLink: string;
  }[];
  loadHistory: () => void;
  /** The txid and output index of the deposit, held across a re-render. */
  txid: string;
  vout: string;
  /** That deposit on a bitcoin explorer, once the field names one. */
  txidShow: boolean;
  txidShort: string;
  txidLink: string;
  /** And the faucet's own payment, which is the other bitcoin this card sees. */
  faucetTxShow: boolean;
  faucetTxShort: string;
  faucetTxLink: string;
  /**
   * Where the member is, read from the bridge. Hidden until it has been read:
   * a route this page cannot see is better left unnarrated than guessed at.
   */
  stageShow: boolean;
  stageStep: string;
  stageTitle: string;
  stageNote: string;
  stageBarW: string;
  stageAmountShow: boolean;
  stageAmount: string;
  /** The five steps, each knowing whether it is behind, live or ahead. */
  s1: L1Step;
  s2: L1Step;
  s3: L1Step;
  s4: L1Step;
  s5: L1Step;
  /** How each button reads: the one to press, and the ones that cannot work. */
  commitBtn: string;
  commitDim: string;
  commitHint: string;
  revealBtn: string;
  revealDim: string;
  revealHint: string;
  depositBtn: string;
  depositDim: string;
  depositHint: string;
  completeBtn: string;
  completeDim: string;
  completeHint: string;
  /** The hash that stands in for the address until it is revealed. */
  digestShow: boolean;
  digestShort: string;
  digestFull: string;
  copyDigest: () => void;
  /** The address the bridge now holds for this member. */
  revealedShow: boolean;
  revealedShort: string;
  revealedFull: string;
  revealedHeld: string;
  copyRevealed: () => void;
  /** Whether the secret that ties the commit to the reveal is still here. */
  saltShow: boolean;
  saltState: string;
  saltTone: string;
  saltNote: string;
  /** The deposit address, once this page has derived one. */
  targetShow: boolean;
  targetHidden: boolean;
  showAddress: () => void;
  targetAddress: string;
  targetShort: string;
  copyTarget: () => void;
  targetAmount: string;
  /** No bitcoin API and no Emily: this page cannot finish the route. */
  offline: boolean;
  offlineWhy: string;
  faucetBtc: () => void;
}

/** One of the five steps, as the card draws it. */
interface L1Step {
  /** A tick once the step is behind the member, its number until then. */
  mark: string;
  bg: string;
  fg: string;
  /** The paragraph's opacity: the live step is the one at full strength. */
  dim: string;
  /** The same again in a word, for a reader who is not reading colours. */
  state: string;
  /** That word's colour, which is the circle's, so the two agree. */
  tone: string;
  /**
   * Whether this step is open, which is not the same as being the live one.
   *
   * Everything a step needs lives inside it -- its addresses, its fields, its
   * button -- and one is unfolded at a time. Usually that is the step the
   * member is on; while they are looking back at an earlier one, it is that.
   */
  now: boolean;
  /**
   * Whether its buttons are shown with it. A step being read is not a step
   * being re-run: the addresses and hashes are worth seeing again mid-wait,
   * and `Commit this address` beside them is an invitation to start over.
   */
  live: boolean;
  /** Open it, or close it again. Only the steps behind the member can be. */
  open: () => void;
  /** A hand where pressing does something, so the row does not look inert. */
  cursor: string;
}

/**
 * The bridge's own two deadlines, in burn blocks, from `bond-bridge.clar`.
 *
 * Repeated here rather than read: they are constants in the contract, not
 * configuration, and a card that says when a commitment lapses is worth more
 * than a read that saves copying two numbers.
 */
/**
 * The reclaim lock, in burn blocks. `l1.ts` builds the address with it; this
 * copy is here so the card can talk about it before that module is loaded.
 * The two are asserted equal by the smoke test rather than left to drift.
 */
const RECLAIM_LOCK_TIME = 950;

/** What the signers may take out of a deposit. In the deposit leaf, not the
 * reclaim one -- the two leaves carry a parameter each. Same reason as above:
 * the card names it before `l1.ts` is loaded. */
const MAX_SIGNER_FEE = 80_000;

const COMMIT_TTL = 36;
const ANNOUNCE_TTL = 1000;

/**
 * A bitcoin txid's page on the explorer, or "" for anything that is not one.
 *
 * Shape-checked here rather than in `config.ts`: a field being typed into
 * holds half a txid most of the time, and a link to half a txid is a link to a
 * 404. Nothing else about it is verified -- whether that transaction exists is
 * the explorer's answer to give.
 */
const btcTxLink = (txid: string): string =>
  /^(0x)?[0-9a-f]{64}$/i.test(txid.trim()) ? explorerBtcTx(txid) : "";

/** What the chain says, but only for the address the field currently holds. */
function l1Known(): L1Chain | null {
  const typed = state.btcAddress.trim();
  const read = state.l1Chain;
  return read && typed !== "" && read.address === typed ? read : null;
}

/** Where the route stands, in the order the contract moves through it. */
interface L1Stage {
  /** The step that is live, 1 to 5 -- or 6, when there is nothing left. */
  current: number;
  /** The step whose button is the one to press. 0 when the answer is "wait". */
  act: number;
  title: string;
  note: string;
  /** What the commitment or the announcement is for, where there is one. */
  amount: string;
}

function l1Stage(c: L1Chain): L1Stage {
  const stx = (ustx: number) => `${(ustx / 1e6).toFixed(2)} STX`;

  // Credited: the bridge has deleted the announcement and the pool holds the
  // sats, so this is the one state the card can call finished.
  if (c.credited) {
    return {
      current: 6,
      act: 0,
      title: "The bitcoin is in the pool",
      note:
        `${written(c.credited.sats)} was credited against this deposit — a little ` +
        `less than you sent, because the sBTC signers take their bitcoin fee out of ` +
        `it. It is a position now, under Your position above, and it is queued ` +
        `until the pool stakes.`,
      amount: "",
    };
  }

  // Somebody else's reveal stands against this address. First reveal takes it,
  // so a reveal of this account's would be refused on chain -- and the sats, if
  // any arrive, are credited to whoever announced it. Said here rather than
  // discovered at step 2, which is a commit too late.
  const other = takenByAnother(c);
  if (other) {
    return {
      current: 1,
      act: 0,
      title: "That address is already spoken for",
      note:
        `The bridge holds an announcement for it made by ${shorten(other)}` +
        (state.account ? `, not by ${shorten(state.account)}` : "") +
        `. First reveal takes an address, so a reveal from here would be ` +
        `refused — and bitcoin sent from it credits them, not you. Use another ` +
        `address you control; any will do.` +
        (c.commitment
          ? ` The commitment this account made against it can be given up at ` +
            `the foot of the card, which hands its STX leg back.`
          : ""),
      amount: c.commitment
        ? `${written(c.commitment.sats)} committed · ${stx(c.commitment.ustx)} paid`
        : "",
    };
  }

  const announced = ourAnnouncement(c);
  if (announced) {
    const amount = `${written(announced.sats)} announced · ${stx(announced.ustx)} paid`;
    const lapses = announced.at + ANNOUNCE_TTL;
    if (c.txid && c.swept) {
      return {
        current: 5,
        act: 5,
        title: "Swept — credit it to the pool",
        note:
          "The signers have swept the deposit and the sBTC registry has it. The " +
          "last call credits what arrived to your position, and anyone may make " +
          "it — a keeper will, eventually, if you would rather not.",
        amount,
      };
    }
    if (c.txid) {
      return {
        current: 4,
        act: 0,
        title: "Waiting for the sBTC signers",
        note:
          "They sweep the deposit in their own time and take their bitcoin fee " +
          "out of it. Nothing here needs you meanwhile; the page can be closed, " +
          "and this card picks the route back up when you return. Step 5 opens " +
          "by itself once the registry has the sweep.",
        amount,
      };
    }
    return {
      current: 3,
      act: 3,
      title: "Send the bitcoin",
      note:
        `The bridge holds this address for you` +
        (c.burn >= lapses
          ? `, though its ${duration(ANNOUNCE_TTL)} are up: anyone may now cancel ` +
            `it and hand the STX leg back. Reveal it again before you send.`
          : ` until burn height ${fmt(lapses)}, about ${duration(lapses - c.burn)} away.`) +
        ` Send from that address and no other — every input of the deposit ` +
        `transaction is checked against it.`,
      amount,
    };
  }

  const made = c.commitment;
  if (made) {
    const amount = `${written(made.sats)} committed · ${stx(made.ustx)} paid`;
    const opens = made.at + 1;
    if (c.burn < opens) {
      return {
        current: 2,
        act: 0,
        title: "The reveal opens shortly",
        note:
          `Committed at burn height ${fmt(made.at)}. The reveal opens at ` +
          `${fmt(opens)} and bitcoin is at ${fmt(c.burn)} — one bitcoin block, about ` +
          `${Math.round(blockMinutes())} minutes. Asked sooner it is refused on chain ` +
          `and costs you the fee, so there is nothing to press yet.`,
        amount,
      };
    }
    return {
      current: 2,
      act: 2,
      title: "Reveal the address",
      note:
        "The wait is over. Revealing names the address in public, and the first " +
        "reveal takes it — which is what the commitment was for." +
        (c.burn >= made.at + COMMIT_TTL
          ? ` Its ${duration(COMMIT_TTL)} are up, so anyone may cancel this ` +
            `commitment instead; the STX leg comes back to you either way.`
          : ""),
      amount,
    };
  }

  return {
    current: 1,
    act: 1,
    title: "Nothing committed for this address",
    note: c.salt
      ? "The bridge holds neither a commitment nor a reveal for it. Step 1 starts " +
        "the route, and takes the STX leg with it."
      : "The bridge holds no reveal for it, and this browser holds no secret for it " +
        "either — so if you committed to this address somewhere else, finish it " +
        "there. The secret never leaves the browser that made it.",
    amount: "",
  };
}

/** The bridge's own topics, said the way the card says everything else. */
const UNDERWAY_NOTICE =
  "This deposit is already committed to on chain, amount and all. To change " +
  "it, give it up at the foot of the card and start again — the STX leg comes " +
  "back to you either way.";

const HISTORY_WORDS: Record<string, string> = {
  "commit-btc-address": "Committed an address",
  "reveal-btc-address": "Revealed it",
  "complete-btc-deposit": "Credited to the pool",
  "cancel-btc-commitment": "Gave up a commitment",
  "cancel-btc-deposit": "Released an address",
  "claim-principal-to-btc": "Took principal out as bitcoin",
};

/** Emily's status word, coloured the way the card colours everything else. */
function emilyTone(status?: string): string {
  const word = (status ?? "").toLowerCase();
  if (word === "confirmed" || word === "accepted") return "var(--color-accent-2-700)";
  if (word === "failed" || word === "rejected") return "var(--color-accent-800)";
  return "var(--color-accent)";
}

/**
 * What that status means for the member, and when to come back.
 *
 * Deliberately about *their* next move rather than about sBTC's internals: a
 * status word is only useful if it answers "is this working" and "how long".
 */
function emilyNote(
  said: { status: string; message: string; lockTime: number } | null,
  chain: L1Chain | null,
): string {
  const sweep =
    `A sweep usually lands within a few bitcoin blocks — ${shortWait(3)} at ` +
    `this chain's pace. Nothing here needs you meanwhile.`;
  if (!said) {
    return (
      "This page has not been able to ask, so the wait cannot be told apart " +
      "from a deposit nobody was told about. If the bitcoin has been sent, " +
      "register it above; if it was registered, press Check again."
    );
  }
  const word = said.status.toLowerCase();
  const because = said.message ? ` (${said.message})` : "";
  if (word === "confirmed") {
    return chain?.credited
      ? "Swept and credited. The sats are in the pool as your queued deposit."
      : `Swept${because}. Step 5 credits it to the pool and anyone may make that call.`;
  }
  if (word === "accepted") {
    return `Accepted${because} — the signers have agreed to sweep it. ${sweep}`;
  }
  if (word === "failed" || word === "rejected") {
    return (
      `The signers will not sweep it${because}. The bitcoin is not lost: the ` +
      `reclaim path in the deposit address is yours alone, and it opens ` +
      `${said.lockTime > 0 ? `${duration(said.lockTime)} after the deposit` : "once its lock expires"}.`
    );
  }
  return `Received${because}, and not swept yet. ${sweep}`;
}

/** A step's circle and its paragraph, given where the member actually is. */
function l1Step(n: number, current: number, blind: boolean): L1Step {
  // A step behind the member can be opened to read. The one they are on is
  // where `review` lands them back.
  const reviewable = n < current && !blind;
  const open = () =>
    setState({ review: state.review === n || n === current ? null : n });
  const shown = state.review === null ? n === current : state.review === n;
  const extra = {
    now: shown,
    live: shown && n === current,
    open,
    cursor: reviewable ? "pointer" : "default",
  };
  // Nothing has been read -- no wallet, or no address to read against. The
  // steps are then five things to know rather than a position, and the card
  // reads as it did before any of this: numbered, and none of them dimmed.
  if (blind) {
    return {
      mark: String(n),
      bg: "var(--color-accent)",
      fg: "var(--color-bg)",
      dim: "0.85",
      state: "",
      tone: "var(--color-accent)",
      ...extra,
      // Nothing is unfolded when there is no position to unfold: the steps are
      // five things to know, and step 1 is where anyone would start anyway.
      now: n === 1,
      live: n === 1,
    };
  }
  if (n < current) {
    return {
      mark: "✓",
      bg: "var(--color-accent-2-600)",
      fg: "var(--color-bg)",
      dim: shown ? "1" : "0.55",
      state: shown ? "done · looking back" : "done",
      tone: "var(--color-accent-2-700)",
      ...extra,
    };
  }
  if (n === current) {
    return {
      mark: String(n),
      bg: "var(--color-accent)",
      fg: "var(--color-bg)",
      dim: "1",
      state: state.review === null ? "you are here" : "you are here — tap to return",
      tone: "var(--color-accent)",
      ...extra,
    };
  }
  return {
    mark: String(n),
    bg: "var(--color-surface)",
    fg: "var(--color-neutral-700)",
    dim: "0.5",
    state: "",
    tone: "var(--color-neutral-700)",
    ...extra,
  };
}

/**
 * The five steps, as version 2 of the bridge has them.
 *
 * What changed is the first two: version 1 committed to a *transaction*, which
 * does not exist until it has been built and signed, so a member had to drive
 * their wallet in two halves and any wallet that cannot hand back a
 * signed-but-unbroadcast transaction was shut out. Version 2 commits to the
 * *address the bitcoin will come from* -- something the member already has --
 * so both Stacks calls happen first and the bitcoin can then be sent by
 * anything, this page included.
 *
 * The card refuses to send bitcoin where the network's sBTC side is not
 * configured. That is not caution for its own sake: a deposit nobody registers
 * with Emily is swept by nobody, and the bitcoin sits at a derived address
 * until its reclaim path opens.
 */
function l1Panel(): L1Panel {
  const btc = bitcoin();
  const target = state.deposit;

  // The wallet has an address for this bitcoin and the field holds a different
  // one -- typed by the member, or left over from before they connected. Both
  // are legitimate: the bridge takes any address the member controls, and only
  // they know which one they will send from. So this is an offer beside the
  // field, not a correction of it, and it disappears the moment the two agree.
  // The wallet is on another bitcoin than this deployment. Everything up to
  // the deposit still works -- the commit and the reveal are Stacks calls
  // about an address typed here, not about the wallet's own -- but the
  // deposit address is derived from the wallet's key, so step 3 cannot be
  // reached from this wallet until the network is changed. Said now rather
  // than at step 3, which is two transactions too late to be useful.
  const walletHere = state.walletBtc === "" || onConfiguredChain(state.walletBtc);

  const typed = state.btcAddress.trim();
  const suggest =
    !l1Underway() &&
    walletHere &&
    Boolean(state.walletBtc) &&
    typed !== "" &&
    typed.toLowerCase() !== state.walletBtc.toLowerCase();

  // Where the member is, where the chain has been asked. `blind` is the
  // ordinary case for a reader: no wallet, or no address to read against, and
  // then the five steps are an explanation rather than a position.
  const chain = l1Known();
  // The announcement this account actually holds. Everything below that says
  // "revealed" has to be about that one: an address somebody else announced is
  // theirs, and describing it here as this member's reveal -- with its hold,
  // its address and its deadline -- is the same lie the locked fields were.
  const mine = chain ? ourAnnouncement(chain) : null;
  const blind = !chain;
  const stage = chain ? l1Stage(chain) : null;
  const current = stage?.current ?? 1;
  // The one to press. Every button stays live -- a step can want re-running,
  // and the contract is the judge of that, not this card -- but only one of
  // them is what to do next.
  const act = blind ? 1 : (stage?.act ?? 0);
  const press = (n: number): string => (n === act ? "btn-primary" : "btn-secondary");
  const fade = (n: number): string => (blind || n === act ? "1" : "0.55");
  const hint = (n: number): string => {
    if (blind) return "";
    if (n === act) return "This is the one to press.";
    if (n < current) return "Done — press it again only if you mean to start over.";
    if (n === current) return stage?.note ?? "";
    return `Step ${current} comes first.`;
  };

  return {
    recipient: state.depositTo || "—",
    quote:
      lockedSats() !== null
        ? `${written(lockedSats()!)} needs ${((lockedUstx() ?? 0) / 1e6).toFixed(2)} STX`
        : state.quotedFor > 0
          ? `${fmt(state.quotedFor)} sats needs ${(state.quotedUstx / 1e6).toFixed(2)} STX`
          : "quoted when you commit",
    address: state.btcAddress,
    addressPlaceholder: addressExample(),
    addressLocked: l1Underway(),
    addressNote: l1Underway()
      ? "This is the address the commitment on chain is a hash of, so it is " +
        "settled too. Every input of the deposit is checked against it. To " +
        "use a different one, give this deposit up at the foot of the card."
      : !state.btcAddress
        ? `The address you will send the bitcoin from — ${addressExample()}. Any address you control will do.`
        : onConfiguredChain(state.btcAddress)
          ? "Send from this address and no other — the bridge checks every input against it."
          : `That is not a ${btc.chain} address. This page is about ${btc.chain} bitcoin, ` +
            `and an address on another chain can neither be paid by the faucet nor spent ` +
            `from here. ${walletNetworkAdvice()}`,
    walletWrongShow: !walletHere,
    walletWrongNote:
      `Your wallet is on another bitcoin: it offers ${state.walletBtc}. ` +
      `${walletNetworkAdvice()} Steps 1 and 2 work meanwhile — they are Stacks ` +
      `calls about the address in the field — but step 3 derives the deposit ` +
      `address from the wallet's own key and will refuse until then.`,
    suggestShow: suggest,
    suggestNote: `Your wallet's ${btc.chain} address:`,
    suggestAddress: state.walletBtc,
    useWallet: () => {
      setValue("btc-address", state.walletBtc);
      setState({ btcAddress: state.walletBtc });
    },
    commit: () => void doCommit(),
    reveal: () => void doReveal(),
    deposit: () => void doDepositBtc(),
    register: () => void doRegister(),
    complete: () => void doComplete(),
    cancel: () => void doCancelL1(),
    // The middle of the route, said out loud. Between "the bitcoin is
    // confirmed" and "the pool has credited it" there is a wait that belongs
    // to neither chain, and a member watching a card that says nothing has no
    // way to tell waiting from broken.
    emilyShow: Boolean(state.emily) || Boolean(state.btcTxid.trim()),
    emilyStatus: state.emily
      ? `The signers: ${state.emily.status}`
      : "The signers: not asked yet",
    emilyTone: emilyTone(state.emily?.status),
    emilyNote: emilyNote(state.emily, chain),
    // Finished, and so the one moment worth offering a fresh start: the
    // route's leftovers -- a txid, a derived address -- are about a deposit
    // that is done, and a second one to the same address needs none of them.
    // What the address is, for a member deciding whether to send real money to
    // a string a web page produced. Every claim here is checkable against the
    // two scripts below it, which is the point: the answer to "can I trust
    // this" should not be "trust us".
    proofShow: Boolean(target),
    proofDeposit: target?.depositScript ?? "",
    proofReclaim: target?.reclaimScript ?? "",
    copyDeposit: () => void copy(target?.depositScript ?? "", "The deposit script"),
    copyReclaim: () => void copy(target?.reclaimScript ?? "", "The reclaim script"),
    proofReclaimNote:
      `If the signers never sweep it, the second path opens after ` +
      `${duration(target?.reclaimLockTime ?? RECLAIM_LOCK_TIME)} and only your ` +
      `key can spend it. Nobody else can move this bitcoin at any point — not ` +
      `this page, not the DAO, not the pool's operator.`,
    // Everything an independent tool needs to arrive at the same address. If
    // it does not, this one is wrong and nothing should be sent to it.
    proofParams: [
      { name: "Recipient (credited)", value: target?.recipient ?? state.depositTo },
      { name: "Signers' public key", value: target?.signersPublicKey ?? "—" },
      { name: "Reclaim public key (yours)", value: target?.reclaimPublicKey ?? "—" },
      {
        name: "Max signer fee",
        value: `${fmt(target?.maxSignerFee ?? MAX_SIGNER_FEE)} sats`,
      },
      {
        name: "Reclaim lock time",
        value: `${fmt(target?.reclaimLockTime ?? RECLAIM_LOCK_TIME)} blocks`,
      },
    ],
    doneShow: Boolean(chain?.credited),
    startAgain: () => {
      forgetSent(state.btcAddress.trim());
      setState({
        btcTxid: "",
        btcVout: "0",
        deposit: null,
        emily: null,
        l1Chain: null,
        review: null,
      });
      setValue("btc-txid", "");
      l1Armed = true;
      void loadL1();
    },
    historyShow: state.history !== null,
    historyEmpty: state.history !== null && state.history.length === 0,
    historyLabel: state.historyReading
      ? "Reading…"
      : state.history === null
        ? "Show my past deposits"
        : "Read it again",
    historyNote:
      "From what the bridge printed, most recent first. It reads the contract's " +
      "last 50 events rather than an index of your own, so a deposit older than " +
      "those will not be here — it is not gone, only further back than this asks.",
    history: (state.history ?? []).map((e) => ({
      what: HISTORY_WORDS[e.topic] ?? e.topic,
      amount: e.sats > 0 ? written(e.sats) : e.ustx > 0 ? `${(e.ustx / 1e6).toFixed(2)} STX` : "",
      txid: e.txid ? shorten(e.txid) : "",
      txidShow: Boolean(e.txid && btcTxLink(e.txid)),
      txidLink: e.txid ? btcTxLink(e.txid) : "",
      stacksLink: e.tx ? explorerTx(e.tx) : "",
    })),
    loadHistory: () => void loadHistory(),
    checkStatus: () => {
      l1Armed = true;
      setState({ notice: "Asking the signers…" });
      void loadL1().then(() => setState({ notice: "" }));
    },
    // When the way out is open, said before it is pressed. The rules are the
    // bridge's: a member may abandon their own commitment whenever, and a
    // revealed address only once its hold has run out.
    cancelWhen: mine
      ? chain!.burn >= mine.at + ANNOUNCE_TTL
        ? "The address is no longer held, so this releases it and pays the STX leg back."
        : `The address is held until burn height ${fmt(mine.at + ANNOUNCE_TTL)}; ` +
          `this works once that has passed, and the bitcoin must not be on its way.`
      : chain?.commitment
        ? "Yours to abandon at any time, as long as you have not sent the bitcoin."
        : "Nothing to give up yet.",
    txid: state.btcTxid,
    vout: state.btcVout,
    txidShow: btcTxLink(state.btcTxid) !== "",
    txidShort: shorten(state.btcTxid.trim().replace(/^0x/, "")),
    txidLink: btcTxLink(state.btcTxid),
    faucetTxShow: btcTxLink(state.btcFaucetTx) !== "",
    faucetTxShort: shorten(state.btcFaucetTx.trim().replace(/^0x/, "")),
    faucetTxLink: btcTxLink(state.btcFaucetTx),

    stageShow: Boolean(stage),
    stageStep: stage ? (stage.current > 5 ? "Finished" : `Step ${stage.current} of 5`) : "",
    stageTitle: stage?.title ?? "",
    stageNote: stage?.note ?? "",
    stageBarW: `${Math.min(100, Math.round((((stage?.current ?? 1) - 1) / 5) * 100))}%`,
    stageAmountShow: Boolean(stage?.amount),
    stageAmount: stage?.amount ?? "",
    s1: l1Step(1, current, blind),
    s2: l1Step(2, current, blind),
    s3: l1Step(3, current, blind),
    s4: l1Step(4, current, blind),
    s5: l1Step(5, current, blind),
    commitBtn: press(1),
    commitDim: fade(1),
    commitHint: hint(1),
    revealBtn: press(2),
    revealDim: fade(2),
    revealHint: hint(2),
    depositBtn: press(3),
    depositDim: fade(3),
    depositHint: hint(3),
    completeBtn: press(5),
    completeDim: fade(5),
    completeHint: hint(5),

    // The hash stands in for the address for exactly one bitcoin block. While
    // it does, it is the only thing on chain that is the member's -- so it is
    // worth showing, and worth saying what it is for.
    digestShow: Boolean(chain?.commitment && !mine && !chain.credited),
    digestShort: middle(chain?.digest ?? "", 12, 8),
    digestFull: chain?.digest ?? "",
    copyDigest: () => void copy(chain?.digest ?? "", "The committed hash"),
    revealedShow: Boolean(mine),
    revealedShort: middle(chain?.address ?? ""),
    revealedFull: chain?.address ?? "",
    revealedHeld: mine ? `held until burn height ${fmt(mine.at + ANNOUNCE_TTL)}` : "",
    copyRevealed: () => void copy(chain?.address ?? "", "The revealed address"),
    // Only while it still matters: after the reveal the secret has done its
    // work and losing it costs nothing.
    saltShow: Boolean(chain && !mine && !chain.credited),
    saltState: chain?.salt ? "kept in this browser" : "not in this browser",
    saltTone: chain?.salt ? "var(--color-accent-2-800)" : "var(--color-accent-800)",
    saltNote: chain?.salt
      ? "It is here and nowhere else — not on a server, not in your wallet. Clear " +
        "this browser's data before you reveal and the commitment can be neither " +
        "revealed nor cancelled from here, so finish the reveal on this machine."
      : "A commitment can only be revealed by whoever holds the secret, and it never " +
        "leaves the browser that made it. If you committed elsewhere, reveal there. " +
        `If it is gone for good, the commitment lapses after ${duration(COMMIT_TTL)} ` +
        `and the STX leg comes back — anyone may cancel it then, and it is paid to you.`,

    targetShow: Boolean(target),
    targetHidden: !target,
    showAddress: () => void doShowDeposit(),
    targetAddress: target?.address ?? "",
    targetShort: middle(target?.address ?? ""),
    copyTarget: () => void copy(target?.address ?? "", "The deposit address"),
    // The address does not depend on the amount, so it is worth deriving before
    // one is typed -- and the heading says the amount only when there is one.
    targetAmount: target && target.sats > 0 ? ` · ${(target.sats / 1e8).toFixed(8)} BTC` : "",
    offline: !btc.configured,
    // Offered whenever there is a faucet to ask, and not gated on what is in
    // the field: the field is uncontrolled, so its value is not in state until
    // the next render, and a button that appears a beat after the address was
    // typed reads as a broken button. `faucet()` reads the field itself and
    // says what is wrong with it -- empty, or an address for another chain.
    faucetBtc: () => void faucet("btc"),
    offlineWhy:
      `This page has no sBTC deposit service configured for ${config.network}: ` +
      `${btc.api ? "" : "no bitcoin API"}${!btc.api && !btc.emily ? " and " : ""}` +
      `${btc.emily ? "" : "no Emily to register the deposit with"}. Every step here ` +
      `still works — the wallet makes an ordinary bitcoin transaction — but nothing ` +
      `here can tell the signers about it, and a deposit they are not told about ` +
      `sits at its address until it is registered or its reclaim path opens. ` +
      `Pass ?btcApi= and ?emily=, or fill in NETWORKS in config.ts.`,
  };
}

/// --- leaving before the term is up -------------------------------------------

interface EarlyPanel {
  /** There is a committed position in a live epoch, so this is worth showing. */
  show: boolean;
  /** …and nothing is stopping the call, so the form is worth showing. */
  ready: boolean;
  /** What is committed, which is the most an early exit can take. */
  committed: string;
  committedSats: string;
  /** What the contract says the call would do, and what it would cost. */
  ustxAtRoll: string;
  banked: string;
  atRisk: string;
  hasAtRisk: boolean;
  sync: () => void;
  amount: string;
  placeholder: string;
  useAll: () => void;
  unstake: () => void;
  /** An exit is already queued, and the contract refuses while it is. */
  blocked: boolean;
  blockedWhy: string;
  cancelExit: () => void;
}

/**
 * `unstake-sbtc-early`: the committed position, back before the term is up.
 *
 * The whole card is about what it costs, because the call itself is one line
 * and the price of it is not obvious:
 *
 *   the sats come back as *released principal*, not into the wallet. pox-5
 *   hands them to the pool, the pool passes them to the treasury, and
 *   `claim-principal` is the second call that finally moves them.
 *
 *   the STX leg does not come back now. pox-5 frees a staker's locked STX on
 *   the bond's own unlock cycle, so a member taking their whole position out is
 *   marked as exiting and the roll releases the STX, exactly as it would have.
 *
 *   rewards the pool has not recognised yet are forfeited, because shares are
 *   what a payout is split by and these shares are gone the moment the call
 *   returns. `sync-rewards` is permissionless and banks what has arrived, so
 *   the card offers it first when the contract says there is something at risk.
 *
 * Every number here is `get-early-unstake-preview`, so the page never has to
 * reproduce the split in JavaScript.
 */
function earlyPanel(): EarlyPanel {
  const m = state.member;
  const settled = m?.settled ?? null;
  const preview = m?.early ?? null;
  const held = settled ? num(settled["bonded-sats"]) : 0;
  // `exit-epoch` is an optional uint: a number once an exit is queued, null
  // until then. `unstake-sbtc-early` refuses while one is set.
  const exiting = settled ? settled["exit-epoch"] != null : false;
  const live = Boolean(state.pool?.live);
  const atRisk = preview ? num(preview["at-risk-rewards"]) : 0;

  const btc = (sats: number) => `${(sats / 1e8).toFixed(4)} BTC`;
  const stx = (ustx: number) => `${(ustx / 1e6).toFixed(2)} STX`;

  return {
    // Not offered where it could not be made: an early exit needs a live epoch
    // to leave and a committed position to take out of it.
    show: state.connected && configured() && held > 0 && live,
    ready: state.connected && configured() && held > 0 && live && !exiting,
    committed: btc(held),
    committedSats: fmt(held),
    ustxAtRoll: stx(preview ? num(preview["ustx-at-roll"]) : 0),
    banked: btc(preview ? num(preview["banked-rewards"]) : 0),
    atRisk: btc(atRisk),
    hasAtRisk: atRisk > 0,
    sync: poolAction("the reward sync", (api) => api.poolCalls.syncRewards()),
    amount: state.earlyAmount,
    placeholder: String(held),
    useAll: () => setState({ earlyAmount: String(held) }),
    unstake: () => void doEarlyUnstake(),
    blocked: exiting,
    blockedWhy:
      "You have already requested an exit, and the contract will not unstake " +
      "early while one is queued — those sats are promised to the roll. Cancel " +
      "the request first if you would rather not wait for it.",
    cancelExit: poolAction("the cancellation", (api) => api.poolCalls.cancelExit()),
  };
}

/**
 * The early exit, from the page.
 *
 * The amount is checked here against what is committed only to say so in
 * words: the contract checks it too, and refuses with `ERR_INVALID_AMOUNT`
 * either way. The manager is the one `get-config` reports, never a value typed
 * here — the same rule `stake` follows, and for the same reason.
 *
 * The explorer opens rather than the transaction being watched in place: what
 * follows a successful call is a second one, `claim-principal`, and the card
 * says so rather than implying the sats are already in the wallet.
 */
async function doEarlyUnstake(): Promise<void> {
  const sats = toSats(field("early-sats"), "sats");
  const held = num(state.member?.settled?.["bonded-sats"] ?? 0);
  if (sats <= 0) return setState({ notice: "Enter how many sats to take out." });
  if (sats > held) {
    return setState({
      notice: `That is more than the ${fmt(held)} sats you have committed.`,
    });
  }
  const manager = String(state.pool?.config?.["signer-manager"] ?? "");
  if (!manager) return setState({ notice: "The pool has no signer manager configured." });
  const api = await chainApi();
  // pox-5 refuses this during a reward cycle's prepare phase, so a call can
  // bounce on timing alone. Said here rather than left to the wallet's own
  // rendering of a pox-5 error code, which is not one a reader can act on.
  const txid = await withWallet("the early exit", () =>
    api.poolCalls.unstakeEarly(manager, sats),
  );
  if (txid) setState({ earlyAmount: "" });
}

/// --- the view model ---------------------------------------------------------------

function decorate(
  p: ProposalBase,
  weight: number,
  hiveWeight: number,
  dummy: boolean,
): ProposalView {
  const mine = state.votes[p.id] ?? p.mine ?? null;
  const echo = state.votes[p.id] && !p.mine ? weight : 0;
  const yes = p.yes + (mine === "for" ? echo : 0);
  const no = p.no + (mine === "against" ? echo : 0);
  const total = yes + no || 1;
  const approval = Math.round((yes / total) * 100);
  const turnout = Math.round((total / (hiveWeight || 1)) * 100);

  const values = [
    p.open ? p.closes : "closed",
    `${turnout}% turnout`,
    `${approval}% for`,
    p.gateState[3] ? "elapsed" : p.closes,
    p.gateState[4] ? "open" : "lapsed",
    `epoch ${state.floor ? state.floor.epoch : 0}`,
  ];
  const gateRows = gateLabels().map((label, i) => ({
    label,
    value: values[i],
    icon: p.gateState[i] ? "✓" : "·",
    dot: p.gateState[i] ? "var(--color-accent-2-600)" : "var(--color-neutral-500)",
    fg: p.gateState[i] ? "var(--color-accent-2-700)" : "var(--color-neutral-700)",
  }));
  const chips = [
    {
      text: `Quorum ${p.gateState[1] ? "met" : "short"}`,
      bg: p.gateState[1] ? "var(--color-accent-2-200)" : "var(--color-neutral-300)",
      fg: p.gateState[1] ? "var(--color-accent-2-800)" : "var(--color-neutral-800)",
    },
    {
      text: `${approval}% approval`,
      bg: approval >= 60 ? "var(--color-accent-2-200)" : "var(--color-neutral-300)",
      fg: approval >= 60 ? "var(--color-accent-2-800)" : "var(--color-neutral-800)",
    },
    { text: p.closes, bg: "var(--color-neutral-200)", fg: "var(--color-neutral-800)" },
  ];

  return {
    ...p,
    dummy,
    yesLabel: fmt(yes),
    noLabel: fmt(no),
    yesW: `${Math.round((yes / total) * 100)}%`,
    noW: `${100 - Math.round((yes / total) * 100)}%`,
    approval: `${approval}%`,
    turnout: `${turnout}%`,
    chips,
    gateRows,
    voted: mine ?? "",
    showVoted: Boolean(mine),
    canVote: p.open && state.connected && !mine,
    needsWallet: p.open && !state.connected,
    open: () => setState({ sel: p.id }),
    voteYes: () => void cast(p.id, true),
    voteNo: () => void cast(p.id, false),
    run: () => void execute(p),
    discuss: () => discuss(p.id),
  };
}

/** The member's weight and the hive's, from chain or the rehearsal. */
function weights(): { weight: number; hiveWeight: number } {
  const live = state.floor;
  const weight = live ? live.weight : Math.floor(Math.sqrt(state.memberSats));
  // quorum is 30% of the hive's total weight, so the whole is quorum / 0.3.
  const hiveWeight = live ? Math.max(live.quorum * (10000 / 3000), 1) : HIVE_WEIGHT;
  return { weight, hiveWeight };
}

/**
 * Whether the floor is showing the fixtures.
 *
 * Left to itself the page shows whatever the chain justifies, so a deployment
 * with nothing raised still explains what a proposal looks like. The switch
 * overrides that in either direction, including onto an empty live floor --
 * seeing that it is empty is the point of asking.
 */
function usingDummy(): boolean {
  const live = state.floor;
  return state.dummy ?? !(live && live.proposals.length);
}

/** Every proposal on the floor, decorated for the markup. */
function proposalList(): ProposalView[] {
  const live = state.floor;
  const { weight, hiveWeight } = weights();
  const dummy = usingDummy();
  const source = dummy
    ? baseProposals()
    : (live?.proposals ?? []).map((entry) => fromChain(entry, live!.burn));
  return source.map((p) => decorate(p, weight, hiveWeight, dummy));
}

function viewModel(): Scope {
  const live = state.floor;
  const bee = beeIdentity();
  const { weight, hiveWeight } = weights();
  const proposals = proposalList();
  const sel = proposals.find((p) => p.id === state.sel) ?? null;

  const totals = state.pool?.totals ?? null;
  // The caption under this one reads "queued, fully withdrawable", so it is the
  // queue -- not the committed position, which is a different number.
  const queued = totals ? num(totals["queued-sats"]) : 0;

  return {
    statSats: totals ? `${(queued / 1e8).toFixed(4)} BTC` : "0",
    // There is no members stat: the ledger keys members by principal and never
    // counts them, so the number does not exist on chain. It was a card that
    // could only ever read as a dash, and counting them is an indexer's job.
    statEpoch: live ? String(live.epoch) : "—",
    // The caption the design drew read "first bond not yet bound", which stops
    // being true the moment one is.
    statEpochNote: state.pool?.live
      ? `bond ${num(state.pool.live["bond-index"])} live, shares committed`
      : state.pool?.bond?.stakeable
        ? `bond ${num(state.pool.bond["bond-index"])} bound, not yet staked`
        : state.pool?.bond?.bound
          ? `bond ${num(state.pool.bond["bond-index"])} missed, awaiting a new bind`
          : "first bond not yet bound",
    statHoney: totals ? `${(num(totals["unclaimed-rewards"]) / 1e8).toFixed(4)} BTC` : "0",

    connected: state.connected,
    disconnected: !state.connected,
    walletOpen: state.walletOpen,
    walletLabel: state.connected ? shorten(state.account) : "Connect wallet",
    profileAddress: state.account ?? "",
    // The chat's identity is a nostr key made in this browser, not the
    // wallet's. A member who has one should be able to find it from here
    // rather than only from inside the discussion panel.
    beeShow: Boolean(bee),
    beeName: bee?.name ?? "",
    beeColor: bee?.color ?? "var(--color-neutral-500)",
    beeNpub: bee?.npubShort ?? "",
    beeNpubFull: bee?.npub ?? "",
    beeLinked: !bee
      ? ""
      : bee.address === ""
        ? "not linked to an address yet — link it in the discussion to read the members' room"
        : bee.address === state.account
          ? bee.member === true
            ? "linked to this address, and verified as a member"
            : bee.member === false
              ? "linked to this address, which holds no position yet"
              : "linked to this address"
          : `linked to ${shorten(bee.address)}, which is not the address connected here`,
    memberSatsLabel: fmt(live ? weight * weight : state.memberSats),
    memberWeight: fmt(weight),
    memberShare: `${((weight / (hiveWeight || 1)) * 100).toFixed(1)}%`,

    // Connected, this opens who you are. Disconnected there is nothing to ask:
    // the wallet's own picker knows which wallets are installed and this page
    // does not, so it goes straight there.
    openWallet: () =>
      state.connected ? setState({ walletOpen: true }) : void doConnect(),
    closeWallet: () => setState({ walletOpen: false }),
    switchAccount: () => void doSwitchAccount(),
    connect: () => void doConnect(),
    disconnect: () => doDisconnect(),
    closeDetail: () => setState({ sel: null }),

    stage: stagePill(),
    bond: bondPanel(),
    launch: launchPanel(),
    join: joinPanel(),
    l1: l1Panel(),
    early: earlyPanel(),

    // Which vault this page is about.
    //
    // Two of them exist on testnet now, holding different money under the same
    // DAO, so the contract stops being a detail a reader can infer from the
    // copy. The header names it, and links to it, and `retired*` is what points
    // at the page for the one this replaced.
    poolShow: configured(),
    poolName: config.pool,
    poolContract: poolContract(),
    poolLink: explorerContract(poolContract()),
    retiredShow: configured() && Boolean(config.retired),
    retiredName: config.retired,
    retiredContract: `${config.deployer}.${config.retired}`,

    // Switching network is a reload, so the choice is a link-like button rather
    // than a control that pretends to toggle state in place.
    networks: SWITCHABLE.map((name) => ({
      name,
      label: name,
      note: hasDeployment(name) ? "" : "not deployed",
      bg: name === config.network ? "var(--color-accent)" : "transparent",
      fg: name === config.network ? "var(--color-bg)" : "var(--color-text)",
      choose: () => (name === config.network ? undefined : setNetwork(name)),
    })),

    proposals,
    sel,
    hasSelection: Boolean(sel),
    noSelection: !sel,
    dummy: usingDummy(),
    noProposals: proposals.length === 0,
    noProposalsWhy: configured()
      ? "Nothing has been raised on this deployment yet. Switch to dummy to see what a proposal reads like."
      : "This page has no deployment configured, so there is no live floor to read. Switch to dummy for the rehearsal.",
    // Which of the two floors you are reading, and a way to cross over. The
    // fixtures are not on chain and no vote here is binding, so saying which is
    // which matters more than the switch itself.
    sources: [
      { dummy: true, label: "Dummy", note: "The design's fixtures. Nothing here is on chain." },
      {
        dummy: false,
        label: "Live",
        note: live?.proposals.length
          ? `${live.proposals.length} raised on ${config.network}`
          : "Nothing raised on chain yet.",
      },
    ].map((option) => ({
      label: option.label,
      note: option.note,
      bg: option.dummy === usingDummy() ? "var(--color-accent)" : "transparent",
      fg: option.dummy === usingDummy() ? "var(--color-bg)" : "var(--color-text)",
      // The selection is an id on the list being left, so it cannot survive the
      // crossing.
      choose: () => setState({ dummy: option.dummy, sel: null }),
    })),

    weightDemo: [
      { label: "0.01 BTC", weight: fmt(1000), stakeW: "1%", sayW: "9%" },
      { label: "0.1 BTC", weight: fmt(3162), stakeW: "10%", sayW: "29%" },
      { label: "1 BTC", weight: fmt(10000), stakeW: "100%", sayW: "92%" },
    ],
    powers: [
      { call: "trust-signer-manager", title: "Add a manager", body: "Vet a signer-manager code hash and trust it. Takes effect at the next roll, never sooner." },
      { call: "distrust-signer-manager", title: "Remove a manager", body: "Takes effect at once. Adding is slow and removing is instant, which is the right way round." },
      { call: "update-bond-registration", title: "Move the registration", body: "Only onto a hash trusted before the live epoch was staked — the emergency switch." },
      { call: "update-operator", title: "Change the seat", body: "Add or retire an operator key. The DAO cannot remove its own entry." },
      { call: "sweep-unattributed-principal", title: "Sweep the stray", body: "Move bitcoin that arrived without an announcement. Measured above everything owed." },
    ],
    gates: [
      { n: "1", label: "Voting period", body: "~2 days. A proposal cannot be raised and settled before anyone has looked at it." },
      { n: "2", label: "Quorum", body: "30% of the hive by weight. An empty room does not get to decide." },
      { n: "3", label: "Supermajority", body: "60% of votes cast. A bare majority is not a mandate." },
      { n: "4", label: "Execution delay", body: "~1 day between carrying and landing, so members who dislike it can request an exit." },
      { n: "5", label: "Execution window", body: "~1 week. After that the mandate lapses and cannot be dusted off later." },
      { n: "6", label: "Same epoch", body: "If the pool rolls, the membership that voted is not the one that would live with it. Void." },
    ],
    trust: [
      { title: "It cannot reach a deposit", body: "Principal lives in the treasury. No operator call moves it, and unattributed sats are measured above everything owed." },
      { title: "It cannot stall the pool", body: "stake, unstake-sbtc, sync-rewards and both claims are permissionless. Members can always get out without it." },
      { title: "It cannot surprise you", body: "A bond must be bound ~4 days before it can be staked, so nobody is carried into terms they had no chance to read." },
      { title: "It cannot lock anyone out", body: "The operator is a set with an enabled flag, and no key may change its own entry. Handover takes two moves by two parties." },
    ],
    faq: [
      { q: "What happens if the bond is too small for everything queued?", a: "The roll still happens — missing the window is far worse than rolling light. stake commits what fits, scales every member’s sats by the same fraction, and releases the remainder." },
      { q: "Can I leave mid-bond?", a: "Two ways. Request an exit and it is honoured at the next roll: your principal comes back then, and the final cycle’s honey when that epoch settles. Or leave now — unstake-sbtc-early takes committed sats straight back out of the bond, which is what pox-5 always allowed. The sats become claimable principal at once; the STX leg still waits for the roll, and the rest of that bond’s honey is forfeited." },
      { q: "Why is my weight the square root?", a: "So that capital buys influence at a decreasing rate. Ten thousand times the stake is a hundred times the say — enough to matter, not enough to decide alone." },
      { q: "Why can a queued deposit not vote?", a: "It is withdrawable on demand. Counting it would let anyone rent a majority for a single transaction: deposit, vote, withdraw." },
      { q: "Who can execute a passed proposal?", a: "Anyone. The mandate is the vote, not the executor. If the underlying call fails, the mandate survives and can be spent once it would succeed." },
      {
        q: "Is any of this live?",
        a: configured()
          ? `Yes — this page reads ${config.deployer}.${config.dao} on ${config.network}, and a vote here is a real transaction.`
          : "No. The contracts are unaudited, no deployment is configured for this page, and the pool holds nothing. The vote floor above is a rehearsal.",
      },
    ],
  };
}

/// --- wallet + refresh ------------------------------------------------------------

async function doConnect(): Promise<void> {
  if (!configured()) return setState({ connected: true, walletOpen: false });
  try {
    const api = await chainApi();
    const previous = state.account;
    const account = await api.connect();
    // The wallet is free to hand back an account other than the one this page
    // was showing -- picked at the prompt, or switched inside the wallet with
    // nothing to tell the page about it. Either way what the old account left
    // behind goes with it. `doSwitchAccount` has already cleared by the time it
    // reaches here, so this is the path that covers everything else.
    const changed = account !== null && previous !== null && account !== previous;
    setState({
      ...(changed ? forgetAccount() : {}),
      connected: Boolean(account),
      account,
      walletOpen: false,
    });
    void refresh();
  } catch (error) {
    setState({ notice: `Could not connect: ${message(error)}` });
  }
}

/**
 * Everything on this page that belonged to the account being put down.
 *
 * Most of the page re-reads itself on the next `refresh`, and for a while that
 * looked like enough. It is not, because of what does *not* re-read: the L1
 * card's fields are uncontrolled and hold whatever state says, and `l1Chain`
 * is only read again when `wantsL1()` says so and only ever for the address in
 * the field. Left alone across a switch, the new account arrives at the
 * previous one's bitcoin address, the previous one's amount, and an amount
 * field locked read-only against a commitment it has no part in -- and the
 * lock is the one thing on the card a member cannot type their way out of.
 *
 * So it is cleared here rather than left to be overwritten. The parts kept in
 * `localStorage` are keyed by bitcoin address, not by account, and stay: they
 * are this browser's memory of a route, and the account that owns it is the one
 * that will type that address back in.
 */
function forgetAccount(): Partial<State> {
  // The bitcoin bundle is loaded on demand and this flag is what asks for it.
  // A new account has touched nothing yet.
  l1Armed = false;
  return {
    connected: false,
    account: null,
    votes: {},
    member: null,
    memberSats: 0,
    // The L1 route, whole. `l1Chain` is what locks the fields, and the three
    // fields are what it was read against.
    l1Chain: null,
    btcAddress: "",
    walletBtc: "",
    btcBalance: null,
    btcTxid: "",
    btcVout: "0",
    btcFaucetTx: "",
    deposit: null,
    emily: null,
    review: null,
    route: "",
    // The amount is the other locked field, and `loadL1` writes the committed
    // sats into it -- so it belongs to the commitment, not to the browser.
    amount: "",
    quotedFor: 0,
    quotedUstx: 0,
    earlyAmount: "",
    // Both of these are one account's own history and one account's own
    // transaction; neither means anything under the next.
    history: null,
    historyReading: false,
    pending: null,
  };
}

/**
 * Hand the wallet back and ask again, which is the only way to change account.
 *
 * `connect()` alone may hand back the same account without asking: a wallet
 * that considers itself connected has no reason to prompt. Dropping the
 * connection first makes the question unavoidable.
 */
async function doSwitchAccount(): Promise<void> {
  setState({ walletOpen: false });
  if (!configured()) return;
  try {
    const api = await chainApi();
    api.disconnect();
    setState(forgetAccount());
    await doConnect();
  } catch (error) {
    setState({ notice: `Could not switch accounts: ${message(error)}` });
  }
}

function doDisconnect(): void {
  if (configured()) void chainApi().then((api) => api.disconnect());
  setState({
    ...forgetAccount(),
    // Nothing left for it to be about: a profile of an account that is no
    // longer connected is a dialog full of dashes.
    walletOpen: false,
  });
}

async function refresh(): Promise<void> {
  if (!configured()) return;
  try {
    const api = await chainApi();
    const [floor, pool, member, depositTo] = await Promise.all([
      api.loadFloor(),
      api.loadPool(),
      api.loadMember(),
      api.depositRecipient().catch(() => ""),
    ]);
    // The bitcoin address the L1 card starts with, taken from the connection
    // rather than asked for: a member who wants to deposit from a different
    // address of theirs types over it.
    //
    // Kept in state as well as prefilled, and only where it is an address for
    // this page's bitcoin: a field that already has something in it is not
    // overwritten, so the card offers the wallet's address beside it instead
    // -- which is the case a prefill alone never covered.
    const btc = api.storedBitcoinAddress();
    setState({
      floor,
      pool,
      member,
      depositTo: String(depositTo ?? ""),
      // Kept whichever chain it is on. An address the page cannot use is not
      // nothing -- it is the reason step 3 will refuse, and the member is
      // better told that before they spend a commit and a reveal finding out.
      walletBtc: btc ?? "",
      // Prefilled only when the page could actually use it. Putting an address
      // from another chain in the field just to have the note underneath call
      // it wrong helps nobody -- the placeholder says more.
      ...(btc && onConfiguredChain(btc) && !state.btcAddress
        ? { btcAddress: btc }
        : {}),
    });
    // What that address holds, for the route choice. Fired and forgotten: the
    // card reads fine without it, and it must never hold up the rest.
    const forBalance = btc && onConfiguredChain(btc) ? btc : state.btcAddress;
    if (forBalance && onConfiguredChain(forBalance)) {
      void readBtcBalance(forBalance).then((sats) => setState({ btcBalance: sats }));
    }
    // Only where this member is actually on the L1 route: it costs the bitcoin
    // bundle, and most connections are for the vote floor or the sBTC card.
    if (wantsL1()) void loadL1();
  } catch (error) {
    setState({ notice: `Could not read the DAO: ${message(error)}` });
  }
}

/// --- mount ----------------------------------------------------------------------

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

  wireQuote();
  wireEarly();
  wireL1();
  syncChat();
}

/**
 * Quote the STX leg as the amount is typed.
 *
 * Written straight into the DOM rather than through `setState`: a re-render
 * replaces the input the member is typing into, and the caret goes with it.
 * The inputs stay uncontrolled for the same reason -- their values are read
 * when a button is pressed, not held in state.
 */
let quoting: ReturnType<typeof setTimeout> | null = null;
function wireQuote(): void {
  const input = document.getElementById("join-sats") as HTMLInputElement | null;
  const out = document.getElementById("join-quote");
  if (!input || !out || input.dataset.wired === "1") return;
  input.dataset.wired = "1";

  input.value = state.amount;
  // Locked once the route is committed: the digest on chain mixed this number
  // in, so changing it here could only mislead. Not disabled -- a disabled
  // field is unreadable and uncopyable, and this one is worth reading.
  input.readOnly = lockedSats() !== null;

  input.addEventListener("input", () => {
    if (input.readOnly) return;
    // Held so a re-render can put it back; not `setState`, which would replace
    // the element under the caret.
    state.amount = input.value;
    const sats = toSats(input.value, state.unit);
    if (quoting) clearTimeout(quoting);
    if (sats <= 0) {
      out.textContent = "enter an amount";
      return;
    }
    out.textContent = "quoting…";
    quoting = setTimeout(async () => {
      if (!configured()) {
        out.textContent = "no deployment configured";
        return;
      }
      try {
        const api = await chainApi();
        const ustx = Number(await api.quote(sats));
        state.quotedFor = sats;
        state.quotedUstx = ustx;
        out.textContent = `${fmt(sats)} sats needs ${(ustx / 1e6).toFixed(2)} STX`;
      } catch (error) {
        out.textContent = `could not quote: ${message(error)}`;
      }
    }, 350);
  });
}

/**
 * The early exit's amount field: held across a re-render, and read back in
 * whichever unit has fewer zeros to miscount.
 *
 * Same shape as `wireQuote` and for the same reason -- a re-render replaces the
 * element being typed into -- but with nothing to ask the chain: sats to BTC is
 * a division, and the card has already been told what the call would return.
 */
function wireEarly(): void {
  const input = document.getElementById("early-sats") as HTMLInputElement | null;
  const out = document.getElementById("early-hint");
  if (!input || !out || input.dataset.wired === "1") return;
  input.dataset.wired = "1";

  input.value = state.earlyAmount;

  const show = (value: string) => {
    const sats = toSats(value, "sats");
    out.textContent = sats > 0 ? `= ${(sats / SATS_PER_BTC).toFixed(8)} BTC` : "";
  };
  show(input.value);

  input.addEventListener("input", () => {
    // Held so a re-render can put it back; not `setState`, which would replace
    // the element under the caret.
    state.earlyAmount = input.value;
    show(input.value);
  });
}

/**
 * The L1 card's own two fields, held across a re-render.
 *
 * Same reason as the other two: the inputs are uncontrolled because a
 * re-render replaces the element being typed into and the caret goes with it.
 * These hold the amount and the address between steps, which here span several
 * transactions and at least one burn block.
 */
function wireL1(): void {
  const hold = (id: string, keep: (value: string) => void) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input || input.dataset.wired === "1") return;
    input.dataset.wired = "1";
    input.addEventListener("input", () => keep(input.value));
    // `change` rather than `input`: reading the route back re-renders the card,
    // and a re-render replaces the element being typed into. On blur the member
    // has finished with the field, so there is no caret to lose.
    input.addEventListener("change", () => {
      keep(input.value);
      l1Armed = true;
      void loadL1();
    });
  };
  hold("btc-address", (value) => (state.btcAddress = value));
  // Locked for the same reason the amount is: the commitment on chain is a
  // hash of *this* address, and the reveal is checked against it. Editing it
  // here could only produce a route that no longer matches.
  const addressField = document.getElementById("btc-address") as HTMLInputElement | null;
  if (addressField) addressField.readOnly = l1Underway();
  hold("btc-txid", (value) => (state.btcTxid = value));
  // Open where there is already a deposit to show. `open` is a boolean
  // attribute -- any value at all opens it -- so it cannot be bound in the
  // template, and this is the same trick the amount field's `readOnly` uses.
  const sent = document.getElementById("btc-sent") as HTMLDetailsElement | null;
  if (sent && state.btcTxid.trim()) sent.open = true;
  hold("btc-vout", (value) => (state.btcVout = value));
}

// Paint first, then reach for the chain: the page reads the same either way,
// and a slow node should not hold up the text.
render();

// The discussion panel, beside the page rather than in it. What it needs from
// here is the wallet and the proposals; what it gives back is a place to talk
// about them. Its own network layer loads once the page has painted.
mountChat(() => ({
  account: state.account,
  connected: state.connected,
  configured: configured(),
  proposals: proposalList().map((p) => ({ id: p.id, title: p.title })),
  openWallet: () =>
    state.connected ? setState({ walletOpen: true }) : void doConnect(),
  signMessage: async (text) => (await chainApi()).signMessage(text),
  showProposal: (id) => {
    setState({ sel: id });
    document.getElementById("vote")?.scrollIntoView({ behavior: "smooth", block: "start" });
  },
}));

if (configured()) {
  void chainApi().then((api) => {
    const account = api.loadAccount();
    setState({ account, connected: Boolean(account) });
    void refresh();
  });
}
