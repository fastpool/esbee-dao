// Where the contracts are.
//
// Deliberately dependency-free: `app.ts` imports this eagerly to decide whether
// it needs the chain layer at all, and pulling stacks.js in for that decision
// would defeat the point of code-splitting it.
//
// The contracts are not deployed to a fixed address yet, so this is
// configuration. Fill in DEPLOYMENTS, or override per visit with
// `?network=testnet&deployer=ST…`.

export type NetworkName = "testnet" | "mainnet" | "devnet";

/**
 * The bitcoin side of the L1 route, which is not one thing but three.
 *
 * A deposit only reaches the pool if all of them agree with the sBTC
 * deployment in `sbtc` below: the address is encoded for the chain its signers
 * watch, the transaction is read back from an API that indexes that chain, and
 * the deposit is registered with the Emily those signers poll. An sBTC deposit
 * nobody is told about is not swept -- the bitcoin sits at a taproot address
 * until its reclaim path opens -- so where any of this is unknown the page
 * refuses to send rather than guessing.
 */
export interface BitcoinInfo {
  /** What an address is encoded for: `tb1…` for testnet, `bcrt1…` for regtest. */
  chain: "mainnet" | "testnet" | "regtest";
  /** An esplora-compatible API. "" means the page cannot read a tx back. */
  api: string;
  /**
   * Emily, which tells the signers a deposit exists. "" means it cannot.
   *
   * On Netlify this is the site's own `/emily/<network>`, which attaches the
   * instance's token server-side -- the same trade `apiBase()` makes for the
   * Hiro key, and for the same reason: a token in a static bundle is not a
   * token. Anywhere else it is the host itself, unauthenticated, so a local
   * build needs no function running.
   */
  emily: string;
}

export interface NetworkInfo {
  api: string;
  explorer: string;
  /** sBTC is the same contract name on every network, at a different address. */
  sbtc: string;
  /** pox-5, whose boot address differs between mainnet and the rest. */
  pox: string;
  /**
   * How long a burn block takes here, in minutes -- what every countdown on
   * the page is drawn at.
   *
   * Not the same number everywhere, and the difference is not cosmetic:
   * bitcoin's ten minutes on mainnet, but the testnet4 chain Stacks testnet is
   * anchored to runs its difficulty-reset rule hard and has been landing
   * blocks at about four, and a devnet regtest mines on a timer of seconds. A
   * ten-minute assumption on testnet reports a two-day stake window as five,
   * which is a countdown that can talk an operator out of a bond it had time
   * for. `?blockMinutes=` overrides it where a chain does neither.
   */
  blockMinutes: number;
  bitcoin: BitcoinInfo;
}

export const NETWORKS: Record<NetworkName, NetworkInfo> = {
  testnet: {
    api: "https://api.testnet.hiro.so",
    explorer: "https://explorer.hiro.so",
    sbtc: "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token",
    pox: "ST000000000000000000002AMW42H.pox-5",
    blockMinutes: 4, // measured, not nominal: testnet4's twenty-minute rule keeps it well under bitcoin's ten
    // Stacks testnet is anchored to bitcoin testnet4, which encodes addresses
    // exactly as testnet3 does -- `tb1…`, and m/n/2 in base58 -- so `testnet`
    // is the right chain for an address either way, and only the API has to
    // name testnet4 specifically.
    //
    // Emily is a dev instance. `https`, not `http`: this page is served over
    // TLS and a browser blocks a plain-text fetch out of it, so an `http://`
    // endpoint here would not be reachable at all. `?btcApi=` and `?emily=`
    // point a visit somewhere else -- at the environment's own explorer, if its
    // bitcoin is not the public testnet4.
    bitcoin: {
      chain: "testnet",
      api: "https://mempool.space/testnet4/api",
      emily: "https://temp.sbtc-emily-dev.com",
    },
  },
  mainnet: {
    api: "https://api.hiro.so",
    explorer: "https://explorer.hiro.so",
    sbtc: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    pox: "SP000000000000000000002Q6VF78.pox-5",
    blockMinutes: 10, // bitcoin
    bitcoin: {
      chain: "mainnet",
      api: "https://mempool.space/api",
      emily: "https://sbtc-emily.com",
    },
  },
  devnet: {
    api: "http://localhost:3999",
    explorer: "http://localhost:8000",
    sbtc: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    pox: "ST000000000000000000002AMW42H.pox-5",
    blockMinutes: 0.5, // a regtest burnchain on a timer -- Clarinet's default is thirty seconds
    bitcoin: {
      chain: "regtest",
      api: "http://localhost:3010/api/proxy",
      emily: "http://localhost:3031",
    },
  },
};

interface Deployment {
  deployer: string;
  dao: string;
  pool: string;
  /** The bridge that credits L1 bitcoin into this pool, and no other. */
  bridge: string;
  /**
   * The pool this one replaced, if any.
   *
   * A vault is never migrated in place -- a member's position is sBTC and STX
   * the old contract still holds, and only the member can move it. So the
   * retired pool keeps a page of its own at `v1/`, and this is what tells the
   * live page there is one to point at.
   */
  retired?: string;
}

// The pool's own name is not fixed: pox-5 keys a bond's allowlist on the
// staker's principal, so a deployment takes whatever name its grant spells --
// `vault-2` on testnet, `bond-staker` on mainnet.
//
// A deployment is four contracts that name each other, not one: the vault, the
// DAO that holds its operator seat, the treasury that holds its principal and
// the bridge that credits bitcoin into it. Testnet's second set is `-2` all the
// way through, and mixing halves would read the wrong DAO's proposals against
// the right pool's shares. So the names move together, from here.
//
// Mainnet has no address yet. Filling it in is all that switching takes: the
// selector below is live on every network, and one with no deployer falls back
// to the rehearsal rather than erroring.
const DEPLOYMENTS: Record<NetworkName, Deployment> = {
  testnet: {
    deployer: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM",
    dao: "esbee-dao-2",
    pool: "vault-2",
    bridge: "bond-bridge-2",
    retired: "vault-1",
  },
  mainnet: { deployer: "", dao: "esbee-dao", pool: "bond-staker", bridge: "bond-bridge" },
  devnet: { deployer: "", dao: "esbee-dao", pool: "bond-staker", bridge: "bond-bridge" },
};

/** Networks the page offers to switch between, in the order they are shown. */
export const SWITCHABLE: NetworkName[] = ["testnet", "mainnet"];

const STORED_NETWORK = "esbee:network";

const isNetwork = (value: string | null): value is NetworkName =>
  value === "testnet" || value === "mainnet" || value === "devnet";

const params = new URLSearchParams(
  typeof location === "undefined" ? "" : location.search,
);

// `?network=` wins, then whatever was last chosen here, then testnet.
const stored =
  typeof localStorage === "undefined" ? null : localStorage.getItem(STORED_NETWORK);
const requested = params.get("network") ?? stored;
const network: NetworkName = isNetwork(requested) ? requested : "testnet";
const deployment = DEPLOYMENTS[network];

/**
 * Switch networks and reload.
 *
 * A reload rather than a re-read: every address, every cached read and the
 * wallet's own idea of the chain are all bound to the network, and starting
 * clean is more honest than trying to invalidate each of them.
 */
export function setNetwork(next: NetworkName): void {
  localStorage.setItem(STORED_NETWORK, next);
  const url = new URL(location.href);
  url.searchParams.delete("network");
  url.searchParams.delete("deployer");
  location.href = url.toString();
}

/** Whether a network has contracts to talk to, for labelling the switcher. */
export const hasDeployment = (name: NetworkName): boolean =>
  Boolean(DEPLOYMENTS[name].deployer);

export const config = {
  network,
  deployer: params.get("deployer") ?? deployment.deployer,
  dao: params.get("dao") ?? deployment.dao,
  pool: params.get("pool") ?? deployment.pool,
  bridge: params.get("bridge") ?? deployment.bridge,
  /** The retired pool `v1/` is about, or "" where this network never had one. */
  retired: deployment.retired ?? "",
};

/** Whether there is a deployment to talk to at all. */
export const configured = (): boolean => Boolean(config.deployer);

export const net = (): NetworkInfo => NETWORKS[config.network];

/**
 * How long a burn block takes on the configured chain.
 *
 * A function rather than a constant so `?blockMinutes=` can override it the
 * way the bitcoin endpoints are overridden: a private burnchain keeps neither
 * bitcoin's pace nor testnet4's, and a countdown drawn at the wrong one is
 * worse than no countdown at all.
 */
export const blockMinutes = (): number => {
  const asked = Number(params.get("blockMinutes"));
  return Number.isFinite(asked) && asked > 0 ? asked : net().blockMinutes;
};

/**
 * The bitcoin side, with the per-visit overrides applied.
 *
 * Overridable because the three values belong to the sBTC deployment rather
 * than to this pool, and an environment can be stood up without any of them
 * being public. `configured` is what the L1 card asks before it offers to move
 * bitcoin: everything up to the reveal is Stacks and works without them.
 */
/**
 * Whether a bitcoin address belongs to the chain this page is configured for.
 *
 * A prefix test rather than a decode, for the same reason `app.ts` repeats the
 * Stacks one: the answer decides what a reader is shown and which address is
 * prefilled, and it must not cost the bitcoin module. `l1.ts` does the real
 * decoding before anything is committed, and is the one that refuses.
 *
 * It matters most at the faucet, which pays whatever address it is given: a
 * mainnet address handed to a testnet faucet is a request that can only fail,
 * and one handed to a mainnet faucet does not exist.
 */
export const onConfiguredChain = (address: string): boolean => {
  const value = address.trim();
  if (!value) return false;
  const { chain } = bitcoin();
  const bech = /^(bcrt1|bc1|tb1)/i.exec(value)?.[1]?.toLowerCase();
  if (bech) {
    return bech === { mainnet: "bc1", testnet: "tb1", regtest: "bcrt1" }[chain];
  }
  // base58: mainnet pays 1… and 3…; every other chain pays m…, n… and 2….
  return chain === "mainnet" ? /^[13]/.test(value) : /^[mn2]/.test(value);
};

/** What an address on that chain looks like, for a field's placeholder. */
export const addressExample = (): string =>
  ({ mainnet: "bc1q…", testnet: "tb1q…", regtest: "bcrt1q…" })[bitcoin().chain];

export const bitcoin = (): BitcoinInfo & { configured: boolean } => {
  // `EMILY_PROXY` is defined at the foot of this file, beside the other build
  // switch. Read here rather than there because this is the only caller.
  const base = net().bitcoin;
  const chain = params.get("btcChain") ?? base.chain;
  // Registering a deposit is the one call this site makes that carries a
  // secret, so on Netlify it goes through the site's own function. `?emily=`
  // still wins, for a developer pointing at an instance of their own.
  const emily =
    params.get("emily") ?? (EMILY_PROXY ? `${EMILY_PROXY}/${network}` : base.emily);
  const info = {
    chain: (chain === "mainnet" || chain === "testnet" || chain === "regtest"
      ? chain
      : base.chain) as BitcoinInfo["chain"],
    api: (params.get("btcApi") ?? base.api).replace(/\/$/, ""),
    emily: emily.replace(/\/$/, ""),
  };
  return { ...info, configured: Boolean(info.api && info.emily) };
};

/**
 * Where reads go, which is not always the node itself.
 *
 * On Netlify the build points this at the site's own `/api/<network>` function,
 * which attaches the Hiro key server-side: an anonymous read shares its rate
 * limit with the whole internet, and a key that shipped in the bundle would not
 * be a secret. Anywhere else -- a local build, a plain static host -- it is the
 * Hiro host itself, anonymously, so nothing here depends on the proxy existing.
 *
 * `scripts/build.mjs` decides, because only a build knows which of the two it
 * is producing. `typeof` rather than a bare read: undefined is the normal case
 * for a build that never defined it.
 */
declare const __API_PROXY__: string | undefined;

/**
 * And where a deposit is registered, which is the same decision again.
 *
 * Separate from the one above because it is a different function answering a
 * different host: `netlify/functions/emily.mjs`, which attaches the instance's
 * token. Off a Netlify deploy it is empty and `bitcoin()` talks to Emily
 * directly, unauthenticated -- which is what a local build should do, and what
 * `?emily=` overrides when a developer has a token of their own.
 */
declare const __EMILY_PROXY__: string | undefined;

const PROXY = typeof __API_PROXY__ === "string" ? __API_PROXY__ : "";
const EMILY_PROXY = typeof __EMILY_PROXY__ === "string" ? __EMILY_PROXY__ : "";

export const apiBase = (): string =>
  PROXY ? `${PROXY}/${config.network}` : net().api;
export const explorerTx = (txid: string): string =>
  `${net().explorer}/txid/${txid}?chain=${config.network}`;

/**
 * The contract this page is actually talking to, and where to go and read it.
 *
 * Two vaults now exist on testnet and they hold different money, so which one a
 * page is about stops being a detail: the header says it, and this is what it
 * says. The explorer takes a contract id in the same place as a txid.
 */
export const poolContract = (): string => `${config.deployer}.${config.pool}`;
export const explorerContract = (id: string): string =>
  `${net().explorer}/txid/${id}?chain=${config.network}`;
