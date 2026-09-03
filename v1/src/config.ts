// Where the contracts are -- for the retired vault.
//
// This is the `v1/` copy of `src/config.ts`. The only thing it says differently
// is which pool: `vault-1`, the contract the live page has moved off. Nothing
// on this page deposits, so a stale pool name here is not a hazard; it is the
// address a member's money is still sitting at.
//
// Deliberately dependency-free: `app.ts` imports this eagerly to decide whether
// it needs the chain layer at all, and pulling stacks.js in for that decision
// would defeat the point of code-splitting it.
//
// The contracts are not deployed to a fixed address yet, so this is
// configuration. Fill in DEPLOYMENTS, or override per visit with
// `?network=testnet&deployer=ST…`.

export type NetworkName = "testnet" | "mainnet" | "devnet";

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
   * bitcoin's ten minutes on mainnet, but the burnchain under Stacks testnet is
   * a regtest one mined on a timer and lands blocks about four minutes apart,
   * and a devnet regtest mines on a timer of seconds.
   * `?blockMinutes=` overrides it where a chain does neither.
   */
  blockMinutes: number;
}

export const NETWORKS: Record<NetworkName, NetworkInfo> = {
  testnet: {
    api: "https://api.testnet.hiro.so",
    explorer: "https://explorer.hiro.so",
    sbtc: "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token",
    pox: "ST000000000000000000002AMW42H.pox-5",
    // Measured over 150 blocks, not nominal: the burnchain here is a regtest
    // one mined on a timer, 4.01 minutes apart.
    blockMinutes: 4,
  },
  mainnet: {
    api: "https://api.hiro.so",
    explorer: "https://explorer.hiro.so",
    sbtc: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    pox: "SP000000000000000000002Q6VF78.pox-5",
    blockMinutes: 10, // bitcoin
  },
  devnet: {
    api: "http://localhost:3999",
    explorer: "http://localhost:8000",
    sbtc: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    pox: "ST000000000000000000002AMW42H.pox-5",
    // A regtest burnchain mines on a timer; Clarinet's default is thirty seconds.
    blockMinutes: 0.5,
  },
};

interface Deployment {
  deployer: string;
  dao: string;
  /** The retired pool this page is about. */
  pool: string;
  /** The bridge that credited bitcoin into it -- also the retired one. */
  bridge: string;
  /** The live pool that replaced it, which is where the main page points. */
  successor: string;
}

// The pool's own name is not fixed: pox-5 keys a bond's allowlist on the
// staker's principal, so a deployment takes whatever name its grant spells.
// `vault-1` is the first vault testnet retired; `vault-3` is the live one now,
// with `vault-2` retired beside this page at `v2/`. Mainnet's first pool is the
// live `esbee-dao-bond-staker-1`, so this page has nothing to show there.
//
// The whole set is the retired one, not just the vault: `esbee-dao` held this
// pool's seat and `bond-bridge` credited bitcoin into it, and both were
// redeployed alongside `vault-2`. A page about the old vault reads the old DAO,
// because that is the one whose proposals were about this money.
const DEPLOYMENTS: Record<NetworkName, Deployment> = {
  testnet: {
    deployer: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM",
    dao: "esbee-dao",
    pool: "vault-1",
    bridge: "bond-bridge",
    successor: "vault-3",
  },
  // Mainnet's first pool is `esbee-dao-bond-staker-1`, so there is nothing
  // retired here to show -- only the way back to it.
  mainnet: { deployer: "", dao: "esbee-dao-1", pool: "", bridge: "bond-bridge-1", successor: "esbee-dao-bond-staker-1" },
  devnet: { deployer: "", dao: "esbee-dao-1", pool: "", bridge: "bond-bridge-1", successor: "esbee-dao-bond-staker-1" },
};

/** Networks the page offers to switch between, in the order they are shown. */
export const SWITCHABLE: NetworkName[] = ["mainnet", "testnet"];

const STORED_NETWORK = "esbee:network";

const isNetwork = (value: string | null): value is NetworkName =>
  value === "testnet" || value === "mainnet" || value === "devnet";

const params = new URLSearchParams(
  typeof location === "undefined" ? "" : location.search,
);

// `?network=` wins, then whatever was last chosen here, then mainnet -- the
// same order and the same default as the live page, which shares this key.
const stored =
  typeof localStorage === "undefined" ? null : localStorage.getItem(STORED_NETWORK);
const requested = params.get("network") ?? stored;
const network: NetworkName = isNetwork(requested) ? requested : "mainnet";
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
  Boolean(DEPLOYMENTS[name].deployer && DEPLOYMENTS[name].pool);

export const config = {
  network,
  deployer: params.get("deployer") ?? deployment.deployer,
  dao: params.get("dao") ?? deployment.dao,
  pool: params.get("pool") ?? deployment.pool,
  bridge: params.get("bridge") ?? deployment.bridge,
  /** The vault that replaced this one, for the way back to the live page. */
  successor: deployment.successor,
};

/**
 * Whether there is a deployment to talk to at all.
 *
 * A retired pool needs both halves: an address, and a network that actually had
 * a vault before this one. Mainnet has neither, and this page says so rather
 * than reading an empty contract name.
 */
export const configured = (): boolean => Boolean(config.deployer && config.pool);

export const net = (): NetworkInfo => NETWORKS[config.network];

/**
 * How long a burn block takes on the configured chain.
 *
 * A function rather than a constant so `?blockMinutes=` can override it:
 * another burnchain keeps neither bitcoin's pace nor this one's, and a
 * countdown drawn at the wrong one is worse than no countdown at all.
 */
export const blockMinutes = (): number => {
  const asked = Number(params.get("blockMinutes"));
  return Number.isFinite(asked) && asked > 0 ? asked : net().blockMinutes;
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

const PROXY = typeof __API_PROXY__ === "string" ? __API_PROXY__ : "";

export const apiBase = (): string =>
  PROXY ? `${PROXY}/${config.network}` : net().api;
export const explorerTx = (txid: string): string =>
  `${net().explorer}/txid/${txid}?chain=${config.network}`;

/** The retired contract this page is about, and where to go and read it. */
export const poolContract = (): string => `${config.deployer}.${config.pool}`;
export const explorerContract = (id: string): string =>
  `${net().explorer}/txid/${id}?chain=${config.network}`;
