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

export interface NetworkInfo {
  api: string;
  explorer: string;
}

export const NETWORKS: Record<NetworkName, NetworkInfo> = {
  testnet: { api: "https://api.testnet.hiro.so", explorer: "https://explorer.hiro.so" },
  mainnet: { api: "https://api.hiro.so", explorer: "https://explorer.hiro.so" },
  devnet: { api: "http://localhost:3999", explorer: "http://localhost:8000" },
};

interface Deployment {
  deployer: string;
  dao: string;
  pool: string;
}

// The pool's own name is not fixed: pox-5 keys a bond's allowlist on the
// staker's principal, so a deployment takes whatever name its grant spells --
// `vault-1` on testnet, `bond-staker` on mainnet.
//
// Mainnet has no address yet. Filling it in is all that switching takes: the
// selector below is live on every network, and one with no deployer falls back
// to the rehearsal rather than erroring.
const DEPLOYMENTS: Record<NetworkName, Deployment> = {
  testnet: {
    deployer: "STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM",
    dao: "esbee-dao",
    pool: "vault-1",
  },
  mainnet: { deployer: "", dao: "esbee-dao", pool: "bond-staker" },
  devnet: { deployer: "", dao: "esbee-dao", pool: "bond-staker" },
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
};

/** Whether there is a deployment to talk to at all. */
export const configured = (): boolean => Boolean(config.deployer);

export const net = (): NetworkInfo => NETWORKS[config.network];
export const explorerTx = (txid: string): string =>
  `${net().explorer}/txid/${txid}?chain=${config.network}`;
