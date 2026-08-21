// Esbee DAO — the retired vault.
//
// This is the `v1/` copy of the site, and it is about `vault-1`: the pool the
// DAO has moved off. It is a copy rather than a mode because the two vaults are
// separate contracts holding separate money, and a page that could be pointed
// at either would be one wrong click away from reading the wrong balances.
//
// What is different from the live page, and why:
//
//   nothing deposits    the amount field, the STX quote, the faucets and
//                       `stake` are gone. Money only leaves this contract.
//   getting out is      `withdraw` for the unstaked leg, `request-exit` and
//   the whole page      `claim-principal` for the committed one, `claim-rewards`
//                       for the honey it still owes.
//   the bridge stays    minus its first step: a member who committed an L1
//                       deposit here still has to reveal, confirm or cancel it.
//
// Everything else -- the DAO, the vote floor, the discussion -- is the same
// contract on both pages, and reads the same.
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
  apiBase,
  config,
  configured,
  explorerContract,
  explorerTx,
  hasDeployment,
  net,
  poolContract,
  setNetwork,
  SWITCHABLE,
} from "./config.js";
import { num } from "./plain.js";
import { discuss, mountChat, syncChat } from "./chat.js";
import type {
  MemberPosition,
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
  /** A withdrawal the wallet accepted, followed until it settles. */
  pending: Pending | null;
  /**
   * Which proposals the floor shows: `true` the fixtures, `false` the chain,
   * `null` whichever the chain justifies -- live if it has any, fixtures if
   * not, which is what a reader arriving at an empty deployment wants.
   */
  dummy: boolean | null;
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
}

// `stake` is not offered here. It is still permissionless on chain, and this
// page still reports what the vault is doing -- but committing what is left in
// a retired pool to another six months is the opposite of what anyone came to
// this page to do.

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

  const reached = share >= MILESTONE;
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
    // The way out, not the way in: the only thing this page invites.
    ctaShow: true,
    ctaLabel: "Take your funds out",

    // The milestone is this page's, not the contract's: `stake` has no opinion
    // about half an allocation and never refuses over it. What it marks is the
    // point where starting beats waiting for a fuller pool -- and past it the
    // call is offered, because anyone may make it.
    milestoneShow: !pool.live,
    milestoneReached: reached,
    milestoneLabel: reached
      ? `Past half the allocation — the pool is worth starting`
      : `50% · ${btc(target * MILESTONE)} launches it`,
  };
}

/// --- leaving --------------------------------------------------------------------

const SALT_KEY = "esbee:salt";

const field = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";

/** What a submitted withdrawal is doing, in the chain's own vocabulary. */
function pendingText(pending: Pending | null): string {
  if (!pending) return "";
  if (pending.status === "pending") {
    return "In the mempool. The sBTC and the STX land back in your wallet as " +
      "soon as a block carries it — you can close this page, it lands either way.";
  }
  if (pending.status === "success") {
    return "Confirmed. The sBTC and the STX are back in your wallet, and this " +
      "vault holds nothing of yours under that leg.";
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
 * The salt a commit was made with, if this browser is the one that made it.
 *
 * Nothing here generates one any more -- there is no commit on this page. What
 * is left is reading back the salt an earlier visit stored, which is what a
 * reveal needs and what a member without it has lost: an unrevealed commitment
 * can then only be cancelled, never used.
 */
const known = (txid: string, vout: number): string | null =>
  localStorage.getItem(`${SALT_KEY}:${txid}:${vout}`);

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

/**
 * `withdraw`: the unstaked leg, both halves of it, out of the retired vault.
 *
 * One call takes back everything still queued -- the sBTC and the STX that was
 * put up beside it -- and it is the whole reason this page still exists.
 * Committed shares are not touched by it; those leave at the roll, which is
 * what `request-exit` below is for.
 *
 * Followed in place rather than in a new tab: this is the transaction the
 * member came here to make, and watching it settle is the answer to "is my
 * money out yet".
 */
async function doWithdraw(): Promise<void> {
  const api = await chainApi();
  const txid = await withWallet("the withdrawal", () => api.poolCalls.withdraw(), false);
  if (!txid) return;
  setState({ pending: { txid, status: "pending" } });
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

async function doReveal(): Promise<void> {
  const txid = field("btc-txid");
  const vout = Number(field("btc-vout") || 0);
  const salt = known(txid, vout);
  if (!salt) {
    return setState({
      notice: "No salt stored here for that txid — commit again from this browser.",
    });
  }
  const api = await chainApi();
  await withWallet("the reveal", () => api.bridgeCalls.reveal(txid, vout, salt));
}

async function doConfirm(): Promise<void> {
  const txid = field("btc-txid");
  const vout = Number(field("btc-vout") || 0);
  if (!txid) return setState({ notice: "Which txid?" });
  const api = await chainApi();
  await withWallet("the confirmation", () => api.bridgeCalls.confirm(txid, vout));
}

/**
 * Give up on a bridged deposit instead of finishing it.
 *
 * The other way out of the bridge, and the one this page is really about: a
 * reveal that was never followed by bitcoin has the member's STX leg sitting in
 * the contract, and cancelling is what returns it.
 */
async function doCancelDeposit(): Promise<void> {
  const txid = field("btc-txid");
  const vout = Number(field("btc-vout") || 0);
  if (!txid) return setState({ notice: "Which txid?" });
  const api = await chainApi();
  await withWallet("the cancellation", () => api.bridgeCalls.cancelDeposit(txid, vout));
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

interface ExitPanel {
  /** The vault this page is about, spelled out rather than implied. */
  contract: string;
  contractName: string;
  contractLink: string;
  successor: string;
  connected: boolean;
  /** No wallet: every row would read "—", so the card asks for one instead. */
  disconnected: boolean;
  connect: () => void;
  /** The wallet is on another chain: nothing here would send. */
  wrongNetwork: boolean;
  networkWarning: string;

  /** Unstaked: queued sBTC and the STX beside it. One call takes both back. */
  unstakedSats: string;
  unstakedUstx: string;
  hasUnstaked: boolean;
  /** The template has no `not`, and a row with nothing in it still says so. */
  noUnstaked: boolean;
  withdraw: () => void;

  /** Committed shares, which leave at the roll rather than on demand. */
  committedSats: string;
  committedUstx: string;
  hasCommitted: boolean;
  exiting: boolean;
  notExiting: boolean;
  exitNote: string;
  requestExit: () => void;
  cancelExit: () => void;

  /** Principal an ended epoch has already released, waiting to be claimed. */
  releasedSats: string;
  releasedUstx: string;
  hasReleased: boolean;
  claimPrincipal: () => void;

  rewards: string;
  hasRewards: boolean;
  claimRewards: () => void;

  /** Nothing of this member's is left in the vault. */
  empty: boolean;
  emptyNote: string;

  /** The withdrawal, followed until the chain settles it. */
  pendingShow: boolean;
  pendingText: string;
  pendingTxid: string;
  pendingLink: string;
}

/**
 * Everything this member still has in `vault-1`, and the call that gets each
 * part of it out.
 *
 * Four rows because the contract has four places a position can be sitting, and
 * they come back by different routes and on different schedules:
 *
 *   unstaked   `withdraw` -- immediate, both legs, no waiting on anything
 *   committed  `request-exit` -- honoured at the next roll, not before
 *   released   `claim-principal` -- an epoch has ended and set it free
 *   honey      `claim-rewards` -- the settled rewards it still owes
 *
 * Collapsing them into one "get me out" button would be a lie about at least
 * two of them, so the card says which is which and offers the calls that exist.
 */
function exitPanel(): ExitPanel {
  const m = state.member;
  const settled = m?.settled ?? null;
  const principal = m?.principal ?? null;

  const btc = (sats: number) => `${(sats / 1e8).toFixed(4)} BTC`;
  const stx = (ustx: number) => `${(ustx / 1e6).toFixed(2)} STX`;

  const queuedSats = settled ? num(settled["queued-sats"]) : 0;
  const queuedUstx = settled ? num(settled["queued-ustx"]) : 0;
  const bondedSats = settled ? num(settled["bonded-sats"]) : 0;
  const bondedUstx = settled ? num(settled["bonded-ustx"]) : 0;
  const releasedSats = principal ? num(principal["released-sats"]) : 0;
  const releasedUstx = principal ? num(principal["released-ustx"]) : 0;
  const rewards = m?.rewards ?? 0;
  // `exit-epoch` is an optional uint: a number once an exit is queued, null
  // until then. Not a flag on the record, so this is the only way to read it.
  const exiting = settled ? settled["exit-epoch"] != null : false;

  const mismatched = Boolean(state.account) && !walletMatchesNetwork(state.account!);
  const anything =
    queuedSats > 0 || queuedUstx > 0 || bondedSats > 0 || releasedSats > 0 || rewards > 0;

  return {
    contract: poolContract(),
    contractName: config.pool,
    contractLink: explorerContract(poolContract()),
    successor: config.successor,
    connected: state.connected,
    disconnected: !state.connected,
    connect: () => setState({ walletOpen: true }),
    wrongNetwork: mismatched,
    networkWarning: mismatched
      ? `Your wallet is a ${/^S[PM]/.test(state.account!) ? "mainnet" : "testnet"} ` +
        `address and this page is on ${config.network}. Switch the wallet's network ` +
        `and reconnect — nothing here would reach ${config.network} otherwise.`
      : "",

    unstakedSats: btc(queuedSats),
    unstakedUstx: stx(queuedUstx),
    // The STX leg alone is worth a button: a deposit whose sats were scaled out
    // at a roll can leave uSTX queued with no sats beside it.
    hasUnstaked: queuedSats > 0 || queuedUstx > 0,
    noUnstaked: !(queuedSats > 0 || queuedUstx > 0),
    withdraw: () => void doWithdraw(),

    committedSats: btc(bondedSats),
    committedUstx: stx(bondedUstx),
    hasCommitted: bondedSats > 0,
    exiting,
    notExiting: !exiting,
    exitNote: exiting
      ? "Your exit is queued. The principal is released at the next roll, and " +
        "the final epoch's honey when that epoch settles."
      : "Committed shares are locked into the bond the vault is standing in. " +
        "Requesting an exit is honoured at the next roll — it cannot be sooner, " +
        "and this vault is not binding another bond.",
    requestExit: poolAction("the exit request", (api) => api.poolCalls.requestExit()),
    cancelExit: poolAction("the cancellation", (api) => api.poolCalls.cancelExit()),

    releasedSats: btc(releasedSats),
    releasedUstx: stx(releasedUstx),
    hasReleased: releasedSats > 0 || releasedUstx > 0,
    claimPrincipal: poolAction("the claim", (api) =>
      api.poolCalls.claimPrincipal(state.account!),
    ),

    rewards: btc(rewards),
    hasRewards: rewards > 0,
    claimRewards: poolAction("the claim", (api) =>
      api.poolCalls.claimRewards(state.account!),
    ),

    empty: state.connected && Boolean(m) && !anything,
    emptyNote: `This address holds nothing in ${config.pool} — no unstaked sBTC ` +
      `or STX, no committed shares, nothing left to claim. There is nothing here ` +
      `to move.`,

    pendingShow: Boolean(state.pending),
    pendingText: pendingText(state.pending),
    pendingTxid: state.pending ? shorten(state.pending.txid) : "",
    pendingLink: state.pending ? explorerTx(state.pending.txid) : "",
  };
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
    exit: exitPanel(),

    // The bridge, minus its first step. Committing a new L1 deposit into a
    // retired vault is not offered; finishing or abandoning one that is already
    // in flight is the only reason these are still here.
    bridge: {
      reveal: () => void doReveal(),
      confirm: () => void doConfirm(),
      cancel: () => void doCancelDeposit(),
    },

    // Which vault this page is about, and where the live one is. Two contracts
    // under one DAO is exactly the situation in which a page has to say.
    poolShow: configured(),
    poolName: config.pool,
    poolContract: poolContract(),
    poolLink: explorerContract(poolContract()),
    successor: config.successor,

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
      { q: "Can I leave mid-bond?", a: "You can request an exit at any time; it is honoured at the next roll. Your principal comes back then, and the final cycle’s honey when that epoch settles." },
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
    const [floor, pool, member] = await Promise.all([
      api.loadFloor(),
      api.loadPool(),
      api.loadMember(),
    ]);
    setState({ floor, pool, member });
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

  syncChat();
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
