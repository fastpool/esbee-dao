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
  config,
  configured,
  explorerContract,
  explorerTx,
  hasDeployment,
  net,
  onConfiguredChain,
  poolContract,
  setNetwork,
  SWITCHABLE,
} from "./config.js";
import { num } from "./plain.js";
import { discuss, mountChat, syncChat } from "./chat.js";
import type {
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
  /** The L1 route's own fields, held across a re-render like the join card's. */
  btcAmount: string;
  btcAddress: string;
  /** The deposit address this page derived, once it has derived one. */
  deposit: DepositTarget | null;
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

/** Where an sBTC deposit has to be sent, and what proves what it was for. */
interface DepositTarget {
  address: string;
  depositScript: string;
  reclaimScript: string;
  sats: number;
}

interface Pending {
  txid: string;
  /** `tx_status` as the API spells it: pending, success, abort_by_response... */
  status: string;
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
  btcAmount: "",
  btcAddress: "",
  deposit: null,
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

// ~10 minutes a burn block, which is all the precision these countdowns need.
function duration(blocks: number): string {
  const hours = Math.round((Math.abs(blocks) * 10) / 60);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

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

  if (bond && bond.bound) {
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

  // Nothing bound. What a reader wants to know is what is running, why they
  // cannot join it, and when the next chance comes -- all of which is pox-5's
  // to answer, not the pool's.
  const schedule = pool.schedule;
  if (!schedule) {
    return {
      show: true,
      kicker: "No bond",
      headline: "Nothing bound yet",
      lead: `Deposits are closed until the operator binds a bond. Chain tip is burn ${fmt(burn)}.`,
      rows: [],
    };
  }

  const { current, next } = schedule;
  const btc = (sats: number) => `${(sats / 1e8).toFixed(2)} BTC`;

  // A bond's membership is fixed before it opens: pox-5 only writes the
  // allowlist inside `setup-bond`, so nobody can be added to a running bond.
  // That is why a closed bond stays closed however much room is left in it.
  const closed = Boolean(current?.active);

  return {
    show: true,
    kicker: closed ? "Closed to new members" : "No bond",
    headline: closed
      ? `Bond ${current!.index} is running`
      : `Bond ${next.index} opens at ${fmt(next.start)}`,
    lead: closed
      ? `Bond ${current!.index} opened at burn ${fmt(current!.start)} and runs to ` +
        `${fmt(current!.unlock)}, ${relative(current!.unlock, burn)}. Its members were ` +
        `approved before it opened — pox-5 writes a bond's allowlist once, when the ` +
        `bond is set up, so no staker can be added to one that is already running. ` +
        `The pool's next chance is bond ${next.index} at burn ${fmt(next.start)}, ` +
        `${relative(next.start, burn)}` +
        `${next.allowance === null ? ", once it has been set up with the pool allowlisted" : ""}.`
      : `Deposits are closed until the operator binds a bond. Bond ${next.index} ` +
        `opens at burn ${fmt(next.start)}, ${relative(next.start, burn)}.`,
    rows: [
      row("Chain tip", `burn ${fmt(burn)}`, "now", true),
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
  // Everything `stake` itself checks, so the button is offered only when the
  // call would actually go through.
  const stakeReady =
    reached &&
    burn >= opens &&
    burn >= notice &&
    burn < start &&
    Boolean(preview) &&
    num(preview!["sats"]) > 0 &&
    preview!["meets-floor"] === true;

  const short = preview ? num(preview["short-ustx"]) : 0;
  const overAllocated = Boolean(preview?.["allocation-limited"]);
  const belowFloor = floorSats > 0 && preview !== null && !preview["meets-floor"];

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
    // point where starting beats waiting for a fuller pool -- and past it the
    // call is offered, because anyone may make it.
    milestoneShow: !pool.live,
    milestoneReached: reached,
    milestoneLabel: reached
      ? `Past half the allocation — the pool is worth starting`
      : `50% · ${btc(target * MILESTONE)} launches it`,
    stakeShow: reached && !pool.live && burn < start,
    stakeReady,
    stakeLabel: "Stake the pool — open epoch 0",
    stakeWait: stakeReady
      ? ""
      : burn < notice
        ? `The members' notice runs to burn ${fmt(notice)}, ${relative(notice, burn)}.`
        : burn < opens
          ? `The stake window opens at burn ${fmt(opens)}, ${relative(opens, burn)}.`
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
function useWholeBalance(): void {
  const sats = state.member?.sbtc ?? 0;
  if (sats <= 0) return;
  setState({ amount: fromSats(sats, state.unit) });
  void quoteFor(sats);
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

/** The amount typed into this card, in the contract's own unit. */
const btcSats = (): number => toSats(field("btc-sats"), state.unit);

/** The address typed into it, decoded, or null if it is not one. */
async function btcAddress(): Promise<{ text: string; pox: PoxAddress } | null> {
  const text = field("btc-address");
  if (!text) return null;
  const pox = (await l1Api()).readAddress(text);
  return pox ? { text, pox } : null;
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
    setState({
      notice:
        "Committed. The reveal opens one bitcoin block later — about ten " +
        "minutes — and step 2 says so if it is asked sooner.",
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
  if (burn < opensAt) {
    return setState({
      notice:
        `The reveal opens at burn height ${fmt(opensAt)} and the chain is at ` +
        `${fmt(burn)} — one bitcoin block, so about ten minutes. Revealing now ` +
        `would be refused on chain and cost you the fee.`,
    });
  }
  await withWallet("the reveal", () => api.bridgeCalls.revealAddress(address.pox, salt));
}

/**
 * Where the bitcoin has to go: an sBTC deposit address for the treasury.
 *
 * Derived rather than looked up. `get-deposit-address` names the *principal*
 * the signers must credit; the bitcoin address that makes them credit it is a
 * one-off taproot output whose script tree holds that principal, the signers'
 * current key, and a reclaim path belonging to this member. All three come from
 * somewhere authoritative -- the bridge, the sBTC registry, and the wallet.
 */
async function depositTarget(sats: number): Promise<DepositTarget> {
  const [api, bitcoinSide] = await Promise.all([chainApi(), l1Api()]);
  const account = await api.bitcoinAccount();
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
        `to try again.`,
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
  const txid = field("btc-txid");
  const sats = btcSats();
  if (!txid) return setState({ notice: "Which txid?" });
  try {
    const target = state.deposit ?? (await depositTarget(sats));
    const vout = await register(target, txid);
    setValue("btc-vout", String(vout));
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
  const txid = field("btc-txid");
  const vout = Number(field("btc-vout") || 0);
  if (!txid) return setState({ notice: "Which txid?" });
  try {
    setState({ notice: "Reading the deposit back from bitcoin…" });
    const bitcoinSide = await l1Api();
    const raw = await bitcoinSide.rawTx(txid);
    const parents = await bitcoinSide.parents(raw);
    const api = await chainApi();
    await withWallet("the credit", () =>
      api.bridgeCalls.complete(txid, vout, raw, parents),
    );
  } catch (error) {
    setState({ notice: `Could not complete it: ${message(error)}` });
  }
}

/** Take the STX leg back from a commitment or an announcement that lapsed. */
async function doCancelL1(): Promise<void> {
  const address = await btcAddress();
  const api = await chainApi();
  if (address) {
    const salt = known(address.text);
    const announced = await api.announcementFor(address.pox);
    if (announced) {
      return void withWallet("the cancellation", () =>
        api.bridgeCalls.cancelDeposit(address.pox),
      );
    }
    if (salt) {
      const digest = String(await api.addressDigest(address.pox, salt));
      return void withWallet("the cancellation", () =>
        api.bridgeCalls.cancelCommitment(state.account!, digest),
      );
    }
  }
  setState({ notice: "Nothing here to cancel for that address." });
}

/** Write into an uncontrolled field the way a member would have. */
function setValue(id: string, value: string): void {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (input) input.value = value;
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
        `only pays ${bitcoin().chain}. One like ${addressExample()} is what it wants.`,
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
  maxHint: string;
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
    quote:
      state.quotedFor > 0
        ? `${fmt(state.quotedFor)} sats needs ${stx(state.quotedUstx)}`
        : "enter an amount",
    balance: m ? btc(m.sbtc) : "—",
    queuedSats: btc(queuedSats),
    queuedUstx: settled ? stx(num(settled["queued-ustx"])) : "0.00 STX",
    committed: settled ? btc(num(settled["bonded-sats"])) : "0.0000 BTC",
    releasedSats: btc(releasedSats),
    rewards: btc(m?.rewards ?? 0),
    hasQueued: queuedSats > 0,
    hasReleased: releasedSats > 0,
    hasRewards: (m?.rewards ?? 0) > 0,
    amount: state.amount,
    amountLabel: state.unit === "sats" ? "Amount in sats" : "Amount in sBTC",
    placeholder: state.unit === "sats" ? "10000000" : "0.1",
    // A quiet pair of words rather than a control: which unit the field is in
    // matters, but not as much as anything else on this card.
    satsFg: state.unit === "sats" ? "var(--color-text)" : "var(--color-neutral-700)",
    satsLine: state.unit === "sats" ? "underline" : "none",
    sbtcFg: state.unit === "sbtc" ? "var(--color-text)" : "var(--color-neutral-700)",
    sbtcLine: state.unit === "sbtc" ? "underline" : "none",
    showSats: () => switchUnit("sats"),
    showSbtc: () => switchUnit("sbtc"),
    useMax: () => useWholeBalance(),
    maxHint: (m?.sbtc ?? 0) > 0 ? "use all" : "",
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
    faucets: config.network === "testnet" && Boolean(state.account) && !mismatched,
    faucetStx: () => void faucet("stx"),
    faucetSbtc: () => void faucet("sbtc"),
  };
}

/// --- the L1 route ------------------------------------------------------------

interface L1Panel {
  /** The principal an sBTC deposit has to credit. */
  recipient: string;
  /** The amount field, and what it is written in -- shared with the join card. */
  amount: string;
  amountLabel: string;
  placeholder: string;
  quote: string;
  /** The address the bitcoin will come from, prefilled from the wallet. */
  address: string;
  addressPlaceholder: string;
  addressNote: string;
  commit: () => void;
  reveal: () => void;
  deposit: () => void;
  register: () => void;
  complete: () => void;
  cancel: () => void;
  /** The deposit address, once this page has derived one. */
  targetShow: boolean;
  targetHidden: boolean;
  showAddress: () => void;
  targetAddress: string;
  targetAmount: string;
  /** No bitcoin API and no Emily: this page cannot finish the route. */
  offline: boolean;
  offlineWhy: string;
  /** Testnet only: bitcoin to actually deposit, paid to the address above. */
  faucet: boolean;
  faucetBtc: () => void;
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

  return {
    recipient: state.depositTo || "—",
    amount: state.btcAmount,
    amountLabel: state.unit === "sats" ? "Amount in sats" : "Amount in sBTC",
    placeholder: state.unit === "sats" ? "10000000" : "0.1",
    quote:
      state.quotedFor > 0
        ? `${fmt(state.quotedFor)} sats needs ${(state.quotedUstx / 1e6).toFixed(2)} STX`
        : "quoted when you commit",
    address: state.btcAddress,
    addressPlaceholder: addressExample(),
    addressNote: !state.btcAddress
      ? `The address you will send the bitcoin from — ${addressExample()}. Any address you control will do.`
      : onConfiguredChain(state.btcAddress)
        ? "Send from this address and no other — the bridge checks every input against it."
        : `That is not a ${btc.chain} address. This page is about ${btc.chain} bitcoin, ` +
          `and an address on another chain can neither be paid by the faucet nor spent from here.`,
    commit: () => void doCommit(),
    reveal: () => void doReveal(),
    deposit: () => void doDepositBtc(),
    register: () => void doRegister(),
    complete: () => void doComplete(),
    cancel: () => void doCancelL1(),
    targetShow: Boolean(target),
    targetHidden: !target,
    showAddress: () => void doShowDeposit(),
    targetAddress: target?.address ?? "",
    // The address does not depend on the amount, so it is worth deriving before
    // one is typed -- and the heading says the amount only when there is one.
    targetAmount: target && target.sats > 0 ? ` · ${(target.sats / 1e8).toFixed(8)} BTC` : "",
    offline: !btc.configured,
    // Offered whenever there is a faucet to ask, and not gated on what is in
    // the field: the field is uncontrolled, so its value is not in state until
    // the next render, and a button that appears a beat after the address was
    // typed reads as a broken button. `faucet()` reads the field itself and
    // says what is wrong with it -- empty, or an address for another chain.
    faucet: config.network === "testnet",
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
      : state.pool?.bond?.bound
        ? `bond ${num(state.pool.bond["bond-index"])} bound, not yet staked`
        : "first bond not yet bound",
    statHoney: totals ? `${(num(totals["unclaimed-rewards"]) / 1e8).toFixed(4)} BTC` : "0",

    connected: state.connected,
    disconnected: !state.connected,
    walletOpen: state.walletOpen,
    walletLabel: state.connected ? shorten(state.account) : "Connect wallet",
    memberSatsLabel: fmt(live ? weight * weight : state.memberSats),
    memberWeight: fmt(weight),
    memberShare: `${((weight / (hiveWeight || 1)) * 100).toFixed(1)}%`,

    openWallet: () => setState({ walletOpen: true }),
    closeWallet: () => setState({ walletOpen: false }),
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
    const account = await api.connect();
    setState({ connected: Boolean(account), account, walletOpen: false });
    void refresh();
  } catch (error) {
    setState({ notice: `Could not connect: ${message(error)}` });
  }
}

function doDisconnect(): void {
  if (configured()) void chainApi().then((api) => api.disconnect());
  setState({ connected: false, account: null, votes: {} });
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
    const btc = api.storedBitcoinAddress();
    setState({
      floor,
      pool,
      member,
      depositTo: String(depositTo ?? ""),
      ...(btc && !state.btcAddress ? { btcAddress: btc } : {}),
    });
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

  input.addEventListener("input", () => {
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
  };
  hold("btc-sats", (value) => (state.btcAmount = value));
  hold("btc-address", (value) => (state.btcAddress = value));
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
  openWallet: () => setState({ walletOpen: true }),
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
