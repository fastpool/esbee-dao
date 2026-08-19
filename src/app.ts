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
  config,
  configured,
  explorerTx,
  hasDeployment,
  setNetwork,
  SWITCHABLE,
} from "./config.js";
import { num } from "./plain.js";
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
  /** The treasury address L1 bitcoin has to be sent to. */
  depositTo: string;
  /** Last quoted STX leg, in uSTX, for whatever is typed in the sats field. */
  quotedFor: number;
  quotedUstx: number;
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
  quotedFor: 0,
  quotedUstx: 0,
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

/// --- joining --------------------------------------------------------------------

const SALT_KEY = "esbee:salt";

const field = (id: string): string =>
  (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";

const satsField = (): number => Math.floor(Number(field("join-sats")) || 0);

/**
 * The salt has to survive between the commit and the reveal, and stay secret
 * until it. So it lives in this browser and nowhere else -- lose it before
 * revealing and the commitment can only be cancelled, not used.
 */
function saltFor(txid: string, vout: number): string {
  const key = `${SALT_KEY}:${txid}:${vout}`;
  const kept = localStorage.getItem(key);
  if (kept) return kept;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const salt = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(key, salt);
  return salt;
}

const known = (txid: string, vout: number): string | null =>
  localStorage.getItem(`${SALT_KEY}:${txid}:${vout}`);

async function withWallet(label: string, run: () => Promise<string | null>) {
  if (!state.connected) return setState({ walletOpen: true });
  try {
    setState({ notice: `Confirm ${label} in your wallet…` });
    const txid = await run();
    setState({ notice: txid ? `${label} submitted — ${txid}` : `${label} submitted` });
    if (txid) window.open(explorerTx(txid), "_blank", "noopener");
    void refresh();
  } catch (error) {
    setState({ notice: `${label} failed: ${message(error)}` });
  }
}

async function doDeposit(): Promise<void> {
  const sats = satsField();
  if (sats <= 0) return setState({ notice: "Enter an amount in sats first." });
  const api = await chainApi();
  const ustx = Number(await api.quote(sats));
  await withWallet("the deposit", () => api.poolCalls.deposit(sats, ustx));
}

async function doCommit(): Promise<void> {
  const sats = satsField();
  const txid = field("btc-txid");
  const vout = Number(field("btc-vout") || 0);
  if (sats <= 0 || !txid) {
    return setState({ notice: "An amount and the txid you are about to broadcast." });
  }
  const api = await chainApi();
  const salt = saltFor(txid, vout);
  const digest = String(await api.depositDigest(txid, vout, salt));
  const ustx = Number(await api.quote(sats));
  await withWallet("the commitment", () => api.bridgeCalls.commit(digest, sats, ustx));
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

const poolAction = (label: string, pick: (api: Awaited<ReturnType<typeof chainApi>>) => Promise<string | null>) =>
  () => void withWallet(label, async () => pick(await chainApi()));

interface JoinPanel {
  open: boolean;
  closed: boolean;
  connected: boolean;
  closedWhy: string;
  depositTo: string;
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
  commit: () => void;
  reveal: () => void;
  confirm: () => void;
  claimPrincipal: () => void;
  claimRewards: () => void;
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

  return {
    open,
    closed: !open,
    connected: state.connected,
    closedWhy: !configured()
      ? "This page has no deployment configured, so nothing here would be sent."
      : !bond?.bound
        ? "Deposits open when the operator binds a bond. Nothing is locked meanwhile."
        : "This bond has started; the next window opens when the pool binds again.",
    depositTo: state.depositTo,
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
    deposit: () => void doDeposit(),
    withdraw: poolAction("the withdrawal", (api) => api.poolCalls.withdraw()),
    commit: () => void doCommit(),
    reveal: () => void doReveal(),
    confirm: () => void doConfirm(),
    claimPrincipal: poolAction("the claim", (api) =>
      api.poolCalls.claimPrincipal(state.account!),
    ),
    claimRewards: poolAction("the claim", (api) =>
      api.poolCalls.claimRewards(state.account!),
    ),
  };
}

/// --- the view model ---------------------------------------------------------------

function decorate(p: ProposalBase, weight: number, hiveWeight: number): ProposalView {
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
  };
}

function viewModel(): Scope {
  const live = state.floor;
  const weight = live ? live.weight : Math.floor(Math.sqrt(state.memberSats));
  // quorum is 30% of the hive's total weight, so the whole is quorum / 0.3.
  const hiveWeight = live ? Math.max(live.quorum * (10000 / 3000), 1) : HIVE_WEIGHT;

  const source =
    live && live.proposals.length
      ? live.proposals.map((entry) => fromChain(entry, live.burn))
      : baseProposals();
  const proposals = source.map((p) => decorate(p, weight, hiveWeight));
  const sel = proposals.find((p) => p.id === state.sel) ?? null;

  const totals = state.pool?.totals ?? null;
  // The caption under this one reads "queued, fully withdrawable", so it is the
  // queue -- not the committed position, which is a different number.
  const queued = totals ? num(totals["queued-sats"]) : 0;

  return {
    statSats: totals ? `${(queued / 1e8).toFixed(4)} BTC` : "0",
    // No member count exists on chain: the ledger keys members by principal and
    // never counts them, so an honest dash beats a number that means something
    // else. Counting them is an indexer's job, over the contract's prints.
    statMembers: state.pool ? "—" : "0",
    statEpoch: live ? String(live.epoch) : "—",
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

    bond: bondPanel(),
    join: joinPanel(),

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
    const [floor, pool, member, depositTo] = await Promise.all([
      api.loadFloor(),
      api.loadPool(),
      api.loadMember(),
      api.depositAddress().catch(() => ""),
    ]);
    setState({ floor, pool, member, depositTo: String(depositTo ?? "") });
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

  input.addEventListener("input", () => {
    const sats = Math.floor(Number(input.value) || 0);
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

// Paint first, then reach for the chain: the page reads the same either way,
// and a slow node should not hold up the text.
render();

if (configured()) {
  void chainApi().then((api) => {
    const account = api.loadAccount();
    setState({ account, connected: Boolean(account) });
    void refresh();
  });
}
