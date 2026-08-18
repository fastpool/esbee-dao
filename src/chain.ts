// Talking to the contracts, with stacks.js.
//
// Reads go straight to a node's read-only endpoint so the site shows real state
// before a wallet is connected; writes go through the connected wallet.
//
// Where the contracts live comes from `config.ts`, which is dependency-free so
// that `app.ts` can decide whether to load this module at all -- everything
// here pulls in stacks.js, and most visitors never connect a wallet.
import {
  Cl,
  cvToHex,
  cvToValue,
  hexToCV,
  type ClarityValue,
} from "@stacks/transactions";
import {
  connect as walletConnect,
  disconnect as walletDisconnect,
  getLocalStorage,
  isConnected,
  request,
} from "@stacks/connect";
import { config, configured, net } from "./config.js";
import { num, plain, type Plain } from "./plain.js";

export { num, plain, type Plain };

export { Cl };

export interface ContractId {
  address: string;
  name: string;
}

export const dao = (): ContractId => ({ address: config.deployer, name: config.dao });
export const pool = (): ContractId => ({ address: config.deployer, name: config.pool });

/// --- wallet -----------------------------------------------------------------

let account: string | null = null;

export function loadAccount(): string | null {
  account = isConnected()
    ? getLocalStorage()?.addresses?.stx?.[0]?.address ?? null
    : null;
  return account;
}

export const currentAccount = (): string | null => account;

export async function connect(): Promise<string | null> {
  await walletConnect();
  return loadAccount();
}

export function disconnect(): void {
  walletDisconnect();
  account = null;
}

/// --- reads -------------------------------------------------------------------

/**
 * Call a read-only function. `sender` falls back to the contract itself, so
 * every read on this page works before a wallet is connected.
 */
export async function readOnly(
  contract: ContractId,
  fn: string,
  args: ClarityValue[] = [],
): Promise<Plain> {
  const { address, name } = contract;
  const response = await fetch(
    `${net().api}/v2/contracts/call-read/${address}/${name}/${fn}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: account ?? address,
        arguments: args.map(cvToHex),
      }),
    },
  );
  const json = (await response.json()) as { okay: boolean; result?: string; cause?: string };
  if (!json.okay || !json.result) throw new Error(json.cause ?? `${fn} failed`);
  return plain(cvToValue(hexToCV(json.result), true));
}

/** The chain tip, for turning the contract's burn heights into "1d 6h left". */
export async function burnHeight(): Promise<number> {
  const info = (await (await fetch(`${net().api}/v2/info`)).json()) as {
    burn_block_height: number;
  };
  return info.burn_block_height;
}

/// --- writes ------------------------------------------------------------------

/**
 * One place for every write, so the wallet call shape is defined once.
 * Returns the txid, or throws with whatever the wallet said.
 */
export async function call(
  contract: ContractId,
  functionName: string,
  functionArgs: ClarityValue[] = [],
): Promise<string | null> {
  if (!account) throw new Error("Connect a wallet first");
  const result = (await request("stx_callContract", {
    contract: `${contract.address}.${contract.name}` as `${string}.${string}`,
    functionName,
    functionArgs,
    network: config.network,
  })) as { txid?: string; txId?: string };
  return result?.txid ?? result?.txId ?? null;
}

/// --- the DAO's own calls -------------------------------------------------------

const strip = (hex: string): string => String(hex).replace(/^0x/, "");

export const daoCalls = {
  vote: (id: number, support: boolean) =>
    call(dao(), "vote", [Cl.uint(id), Cl.bool(support)]),

  proposeTrustSigner: (codeHash: string) =>
    call(dao(), "propose-trust-signer", [Cl.bufferFromHex(strip(codeHash))]),
  proposeDistrustSigner: (codeHash: string) =>
    call(dao(), "propose-distrust-signer", [Cl.bufferFromHex(strip(codeHash))]),
  proposeSignerChange: (manager: string, oldManager: string) =>
    call(dao(), "propose-signer-change", [
      Cl.principal(manager),
      Cl.principal(oldManager),
    ]),
  proposeOperatorChange: (who: string, enabled: boolean) =>
    call(dao(), "propose-operator-change", [Cl.principal(who), Cl.bool(enabled)]),
  proposeSweep: (recipient: string) =>
    call(dao(), "propose-sweep", [Cl.principal(recipient)]),

  // Execution is permissionless: the mandate is the vote, not the executor.
  executeTrustSigner: (id: number) => call(dao(), "execute-trust-signer", [Cl.uint(id)]),
  executeDistrustSigner: (id: number) =>
    call(dao(), "execute-distrust-signer", [Cl.uint(id)]),
  executeOperatorChange: (id: number) =>
    call(dao(), "execute-operator-change", [Cl.uint(id)]),
  executeSweep: (id: number) => call(dao(), "execute-sweep", [Cl.uint(id)]),
  // The only one that takes the managers as traits, so it cannot be driven
  // from the proposal id alone.
  executeSignerChange: (id: number, manager: string, oldManager: string) =>
    call(dao(), "execute-signer-change", [
      Cl.uint(id),
      Cl.principal(manager),
      Cl.principal(oldManager),
    ]),
};

/** Which `execute-*` a carried proposal needs, keyed by the kind it stores. */
export const executorFor: Record<string, (id: number) => Promise<string | null>> = {
  "trust-signer": daoCalls.executeTrustSigner,
  "distrust-signer": daoCalls.executeDistrustSigner,
  "operator-change": daoCalls.executeOperatorChange,
  sweep: daoCalls.executeSweep,
};

/// --- reading the floor ----------------------------------------------------------

/** A proposal as `esbee-dao` stores it. */
export interface StoredProposal {
  kind: string;
  "code-hash": string | null;
  target: string | null;
  previous: string | null;
  enabled: boolean | null;
  proposer: string;
  epoch: number;
  "created-at": number;
  "voting-ends-at": number;
  yes: number;
  no: number;
  executed: boolean;
}

/** What `get-status` computes about it. */
export interface ProposalStatus {
  "voting-open": boolean;
  "votes-cast": number;
  quorum: number;
  "met-quorum": boolean;
  approved: boolean;
  "same-epoch": boolean;
  "executable-from": number;
  expired: boolean;
  executed: boolean;
  ready: boolean;
}

export interface FloorEntry {
  id: number;
  proposal: StoredProposal;
  status: ProposalStatus;
  mine: { support: boolean } | null;
}

export interface Floor {
  burn: number;
  epoch: number;
  quorum: number;
  weight: number;
  proposals: FloorEntry[];
}

/**
 * Every proposal, with its status and this account's vote, plus the numbers the
 * page reports around them. Returns null when there is nothing to read from --
 * no deployment configured.
 */
export async function loadFloor(): Promise<Floor | null> {
  if (!configured()) return null;
  const me = account;

  const [count, quorum, epoch, burn] = await Promise.all([
    readOnly(dao(), "get-proposal-count"),
    readOnly(dao(), "get-quorum"),
    readOnly(dao(), "current-epoch"),
    burnHeight(),
  ]);

  const total = Number(count);
  const ids = Array.from({ length: total }, (_, i) => total - i); // newest first
  const entries = await Promise.all(
    ids.map(async (id): Promise<FloorEntry | null> => {
      const [proposal, status, mine] = await Promise.all([
        readOnly(dao(), "get-proposal", [Cl.uint(id)]),
        readOnly(dao(), "get-status", [Cl.uint(id)]),
        me
          ? readOnly(dao(), "get-vote", [Cl.uint(id), Cl.principal(me)])
          : Promise.resolve(null),
      ]);
      if (!proposal || !status) return null;
      return {
        id,
        proposal: proposal as unknown as StoredProposal,
        status: status as unknown as ProposalStatus,
        mine: (mine as unknown as { support: boolean } | null) ?? null,
      };
    }),
  );

  const weight = me
    ? Number(await readOnly(dao(), "get-weight", [Cl.principal(me)]))
    : 0;

  return {
    burn,
    epoch: Number(epoch),
    quorum: Number(quorum),
    weight,
    proposals: entries.filter((entry): entry is FloorEntry => entry !== null),
  };
}

/** `get-bound-bond`: the bond the pool will stake into next, if any. */
export interface BoundBond {
  bound: boolean;
  stakeable: boolean;
  "bond-index": number;
  "bound-at-height": number;
  "notice-ends-at": number;
  "stake-opens-at": number;
  "start-height": number;
  "unlock-burn-height": number;
  "max-sats": number;
  "min-sats": number;
  "stx-value-ratio": number;
  "min-ustx-ratio": number;
}

/** `get-live-epoch`: the bond the pool is staked into right now, if any. */
export interface LiveEpoch {
  "bond-index": number;
  "staked-sats": number;
  "eligible-sats": number;
  "first-reward-cycle": number;
  "unlock-burn-height": number;
  "staked-at-height": number;
  credited: number;
  "reward-index": number;
}

export interface PoolState {
  totals: Record<string, Plain> | null;
  live: LiveEpoch | null;
  config: Record<string, Plain> | null;
  /** The next bond, and where the chain is relative to its deadlines. */
  bond: BoundBond | null;
  burn: number;
}

/**
 * The pool's own numbers: the stats in the header, and the bond behind the
 * countdown -- the one it is staked into, or the one it is waiting on.
 */
export async function loadPool(): Promise<PoolState | null> {
  if (!configured()) return null;
  const [totals, live, cfg, bond, burn] = await Promise.all([
    readOnly(pool(), "get-pool"),
    readOnly(pool(), "get-live-epoch"),
    readOnly(pool(), "get-config"),
    readOnly(pool(), "get-bound-bond"),
    burnHeight(),
  ]);
  return {
    totals: totals as Record<string, Plain> | null,
    live: live as unknown as LiveEpoch | null,
    config: cfg as Record<string, Plain> | null,
    bond: bond as unknown as BoundBond | null,
    burn,
  };
}
