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
  Pc,
  cvToHex,
  cvToValue,
  hexToCV,
  type ClarityValue,
  type PostCondition,
} from "@stacks/transactions";
import {
  connect as walletConnect,
  disconnect as walletDisconnect,
  getLocalStorage,
  isConnected,
  request,
} from "@stacks/connect";
import {
  apiBase,
  bitcoin,
  config,
  configured,
  net,
  onConfiguredChain,
  walletNetwork,
  walletNetworkAdvice,
} from "./config.js";
import { num, plain, type Plain } from "./plain.js";

export { num, plain, type Plain };

export { Cl };

export interface ContractId {
  address: string;
  name: string;
}

export const dao = (): ContractId => ({ address: config.deployer, name: config.dao });
export const pool = (): ContractId => ({ address: config.deployer, name: config.pool });
export const bridge = (): ContractId => ({ address: config.deployer, name: config.bridge });

/// --- which network an address is on ------------------------------------------

/**
 * Mainnet principals start SP (standard) or SM (contract); every other network
 * uses ST and SN. It is one character, and it is the only thing distinguishing
 * an address that will work from one that will not.
 */
const isMainnetAddress = (address: string): boolean => /^S[PM]/.test(address);

/** Whether an address belongs to the network this page is configured for. */
export const onConfiguredNetwork = (address: string): boolean =>
  isMainnetAddress(address) === (config.network === "mainnet");

/// --- wallet -----------------------------------------------------------------

let account: string | null = null;

/**
 * The connected address, for the network this page is on.
 *
 * `addresses.stx` is a list, and a wallet is free to put more than one in it --
 * commonly the same account on both networks. Taking the first is how a mainnet
 * principal ends up inside a testnet post condition while the wallet signs with
 * the testnet account it actually selected: two addresses from one connection,
 * and only one of them is about this chain.
 */
export function loadAccount(): string | null {
  if (!isConnected()) {
    account = null;
    return null;
  }
  const entries = getLocalStorage()?.addresses?.stx ?? [];
  const matching = entries.find(
    (entry) => entry?.address && onConfiguredNetwork(entry.address),
  );
  // Falling back to the first keeps `signer()` able to say which network the
  // wallet is on, which is more use than the page reporting no wallet at all.
  account = matching?.address ?? entries[0]?.address ?? null;
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

/**
 * Sign a plain-text message with the connected wallet.
 *
 * The chat uses this once, to tie a chat identity to the member's address:
 * the wallet shows the text, the member agrees, and the signature is what every
 * other reader checks. The network check in `signer()` runs first -- a wallet on
 * the other chain would sign for an address the page is not about -- and the
 * caller checks the signature against the address it named before publishing.
 */
export async function signMessage(
  message: string,
): Promise<{ signature: string; publicKey: string }> {
  signer();
  const result = (await request("stx_signMessage", { message })) as {
    signature?: string;
    publicKey?: string;
  };
  if (!result?.signature) throw new Error("The wallet returned no signature");
  return { signature: result.signature, publicKey: result.publicKey ?? "" };
}

export interface BitcoinAccount {
  address: string;
  publicKey: string;
}

/**
 * The wallet's bitcoin account: the address a deposit will come from, and the
 * key that can reclaim it if the signers never sweep.
 *
 * Asked for rather than read out of `getLocalStorage`, which keeps addresses
 * but strips public keys -- and the reclaim leaf of a deposit address is built
 * from one. The payment address is the one wanted: `p2wpkh` where the wallet
 * offers a choice, never the ordinals/taproot account, which is not where
 * spendable coins live.
 */
/**
 * The wallet's bitcoin address as the connection already left it here.
 *
 * For prefilling a field, and nothing more: `getLocalStorage` keeps addresses
 * but strips public keys, and it costs no prompt. Asking the wallet properly is
 * `bitcoinAccount()` below, which is worth a prompt only when a deposit address
 * is actually being built.
 */
export function storedBitcoinAddress(): string | null {
  return pickPayment(getLocalStorage()?.addresses?.btc ?? [])?.address ?? null;
}

/**
 * The address to deposit from, out of everything the wallet handed over.
 *
 * Two filters, in this order. The chain first: a wallet keeps addresses for
 * whichever bitcoin it is on, and offering a member a mainnet address on a page
 * about testnet gets them a faucet that says no and a commitment to an address
 * they cannot spend from. Then the shape: taproot accounts are where ordinals
 * live, and spendable coins are on the payment address beside them.
 */
function pickPayment<T extends { address?: string }>(entries: T[]): T | undefined {
  const usable = entries.filter((entry) => entry?.address);
  const here = usable.filter((entry) => onConfiguredChain(entry.address!));
  const from = here.length ? here : usable;
  return from.find((entry) => !/^(bc1p|tb1p|bcrt1p)/.test(entry.address!)) ?? from[0];
}

/**
 * The wallet's bitcoin account, and the key behind it.
 *
 * `want` is the address the deposit is actually about -- the one committed and
 * revealed. Pass it wherever it is known, because the key this returns ends up
 * in the reclaim leaf of a deposit address, and a reclaim path is only worth
 * anything to whoever holds the key it names. Taking "some payment address the
 * wallet leads with" instead builds a deposit whose reclaim belongs to a
 * different account than the one the bitcoin came from -- which looks like it
 * worked right up until the signers fail to sweep and the member reaches for a
 * key they never used.
 *
 * Without `want` this falls back to the wallet's payment address, which is
 * what the address suggestion beside the field wants.
 */
export async function bitcoinAccount(want?: string): Promise<BitcoinAccount | null> {
  const result = (await request("getAddresses", {})) as {
    addresses?: { symbol?: string; address?: string; publicKey?: string; type?: string }[];
  };
  const entries = (result?.addresses ?? []).filter(
    (entry) => entry?.address && entry.symbol !== "STX" && !/^S[PTMN]/.test(entry.address),
  );

  const wanted = want?.trim().toLowerCase();
  if (wanted) {
    const match = entries.find((entry) => entry.address!.toLowerCase() === wanted);
    if (!match) {
      const offered = entries.map((entry) => entry.address).join(", ");
      throw new Error(
        `This deposit is for ${want}, and the wallet does not offer that address` +
          `${offered ? ` — it offers ${offered}` : ""}. Only the wallet that holds ` +
          `it can build the reclaim path for a deposit from it. ` +
          (offered && !onConfiguredChain(offered.split(", ")[0]!)
            ? walletNetworkAdvice()
            : "Switch to the account that address belongs to, or press \u201cShow the " +
              "deposit address\u201d and pay it from the wallet that has it."),
      );
    }
    return { address: match.address!, publicKey: match.publicKey ?? "" };
  }

  const payment = pickPayment(entries);
  if (!payment?.address) return null;
  if (!onConfiguredChain(payment.address)) {
    throw new Error(
      `The wallet's bitcoin address (${payment.address}) is not on the ` +
        `${bitcoin().chain} bitcoin this page is configured for. ` +
        walletNetworkAdvice(),
    );
  }
  return { address: payment.address, publicKey: payment.publicKey ?? "" };
}

/**
 * Send bitcoin, from the connected wallet, to an address this page derived.
 *
 * The network named is the *bitcoin* one, not the Stacks one: they are not the
 * same word here. Stacks testnet is anchored to a regtest burnchain, and a
 * wallet told "testnet" for a `bcrt1…` recipient has been told something
 * untrue about which chain the transfer is on.
 *
 * It is always named, and leaving it out is not the safe option it looks like.
 * The wallet does not fall back to the network the member has selected: it
 * passes this straight to its own UTXO and fee services as a query parameter,
 * and with nothing to pass it defaults to **mainnet**. A trace of the failing
 * call shows exactly that -- `utxos/addresses/bc1q…?network=mainnet` and
 * `market/bitcoin/fees?network=mainnet` -- while the wallet's own screen shows
 * the regtest balance. Coin selection then runs over a mainnet account with
 * nothing in it and reports `InsufficientFunds`, with the coins in plain sight
 * on the screen behind it.
 *
 * `walletNetwork()` rather than the chain directly, because the name belongs to
 * whoever has to recognise it. See `?walletNetwork=` in config.ts.
 */
export async function sendBitcoin(address: string, sats: number): Promise<string | null> {
  const result = (await request("sendTransfer", {
    // A number, not a string. The type takes either, but the wallet has to add
    // a fee to this and a string is the kind of thing that gets concatenated
    // rather than added -- which would ask for an amount nobody could fund.
    recipients: [{ address, amount: sats }],
    network: walletNetwork(),
  })) as { txid?: string };
  return result?.txid ?? null;
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
    `${apiBase()}/v2/contracts/call-read/${address}/${name}/${fn}`,
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
  const info = (await (await fetch(`${apiBase()}/v2/info`)).json()) as {
    burn_block_height: number;
  };
  return info.burn_block_height;
}

/// --- writes ------------------------------------------------------------------

/**
 * The connected address, once it is established that it belongs to the network
 * everything else here is about.
 *
 * A wallet has its own idea of which network it is on, and it does not have to
 * agree with the page. Where it disagrees the transaction is not merely wrong,
 * it is unsendable -- the contract named does not exist on the chain the wallet
 * would broadcast to -- and the wallet's own error for that is not one a reader
 * can act on. Better to say which two things disagree, before signing.
 */
function signer(): string {
  const me = account;
  if (!me) throw new Error("Connect a wallet first");
  if (!onConfiguredNetwork(me)) {
    throw new Error(
      `This wallet is a ${isMainnetAddress(me) ? "mainnet" : "testnet"} address ` +
        `and the page is on ${config.network}. Switch the wallet's network and reconnect.`,
    );
  }
  return me;
}

/**
 * The same check for the token a post condition names.
 *
 * A post condition is the one part of a call that says what may leave the
 * member's wallet, and it names sBTC by contract -- a different contract on
 * every network. Naming the wrong one does not fail loudly: it produces a
 * condition about a token the transaction never touches, which is a condition
 * that cannot be violated and therefore protects nothing.
 */
function sbtcContract(): `${string}.${string}` {
  const [address, name] = net().sbtc.split(".") as [string, string];
  if (isMainnetAddress(address) !== (config.network === "mainnet")) {
    throw new Error(
      `The sBTC contract configured for ${config.network} is on another network ` +
        `(${address}). Fix NETWORKS in config.ts rather than signing this.`,
    );
  }
  return `${address}.${name}` as `${string}.${string}`;
}

/**
 * One place for every write, so the wallet call shape is defined once.
 * Returns the txid, or throws with whatever the wallet said.
 */
export async function call(
  contract: ContractId,
  functionName: string,
  functionArgs: ClarityValue[] = [],
  conditions?: PostCondition[],
  mode?: "deny" | "originator",
): Promise<string | null> {
  const me = signer();
  // The contract is addressed by `config.deployer`, the post conditions name
  // `config.network`'s sBTC, and this says which chain to broadcast to. All
  // three come from the same place, so they cannot drift apart.
  const result = (await request("stx_callContract", {
    contract: `${contract.address}.${contract.name}` as `${string}.${string}`,
    functionName,
    functionArgs,
    network: config.network,
    // The account the post conditions are written about. A wallet holding more
    // than one is otherwise free to sign with a different one, and a post
    // condition about an address that is not sending cannot fire.
    address: me,
    // Two modes, and `allow` is not one of them. Nothing this page signs needs
    // a transaction that may move anything at all: every call here either
    // sends something the member can name to the microSTX, or sends nothing of
    // theirs whatever the contract does with its own.
    //
    //   deny        the member is sending. The conditions name what, and the
    //               wallet refuses any transfer they do not cover.
    //   originator  the member is not. The conditions constrain the *signing
    //               account* and leave other principals alone, so "nothing of
    //               mine moves" is sayable without having to enumerate the
    //               contract's own transfers to the microSTX -- which is what
    //               `allow` used to paper over, at the cost of the member
    //               having no protection at all.
    //
    // `originator` is newer than the other two and not every wallet will have
    // caught up. That is the right way round: a wallet that cannot express
    // "nothing of mine moves" should feel the gap, rather than every page
    // quietly asking for permission to move everything.
    //
    // Passing no conditions therefore means originator, not allow. An empty
    // array is not the same as none: `[]` under `deny` is the strongest
    // statement available -- no transfer by anyone -- and it is written out
    // where that is what is meant.
    postConditions: conditions ?? [],
    postConditionMode:
      mode ?? (conditions === undefined ? ("originator" as const) : ("deny" as const)),
  })) as { txid?: string; txId?: string };
  return result?.txid ?? result?.txId ?? null;
}

/** Exactly what a deposit of `sats` moves out of the member's wallet. */
function depositConditions(sats: number, ustx: number): PostCondition[] {
  // Both of these throw before anything is built, rather than producing a
  // condition naming the wrong chain's address or the wrong chain's token.
  const me = signer();
  const conditions: PostCondition[] = [
    Pc.principal(me).willSendEq(sats).ft(sbtcContract(), "sbtc-token"),
  ];
  if (ustx > 0) conditions.push(Pc.principal(me).willSendEq(ustx).ustx());
  return conditions;
}

/// --- joining the pool ------------------------------------------------------------

export const poolCalls = {
  /** Both legs in one call: the sBTC and the STX the bound bond prices it at. */
  deposit: (sats: number, ustx: number) =>
    call(pool(), "deposit", [Cl.uint(sats)], depositConditions(sats, ustx)),
  /** Top up the STX leg alone, when a roll has repriced the position. */
  depositStx: (ustx: number) =>
    call(pool(), "deposit-stx", [Cl.uint(ustx)], [
      Pc.principal(signer()).willSendEq(ustx).ustx(),
    ]),
  /**
   * Open the epoch, or roll into the next bond.
   *
   * Permissionless and always was: the contract checks the window, the floor
   * and the notice itself, so there is nothing here to authorize. The manager
   * is the one `get-config` reports -- `stake` refuses any other.
   */
  stake: (manager: string) => call(pool(), "stake", [Cl.principal(manager)]),
  /** Take back everything still queued. Committed shares are not touched. */
  withdraw: () => call(pool(), "withdraw"),
  requestExit: () => call(pool(), "request-exit"),
  cancelExit: () => call(pool(), "cancel-exit"),
  /**
   * Leave mid-term: `sats` of the committed position, back out of the bond.
   *
   * `manager` is a trait argument, and the same principal `stake` takes -- the
   * one `get-config` reports, never a value typed here. `Cl.principal` builds a
   * contract principal from `SP….signer-manager` on its own.
   *
   * Nothing leaves the member's wallet, so this rides on originator mode with
   * nothing permitted rather than naming conditions: pox-5 hands the sats to
   * the pool, which passes them to the treasury and credits them as released
   * principal -- `claim-principal` is what finally moves them, and it carries
   * its own conditions.
   */
  unstakeEarly: (manager: string, sats: number) =>
    call(pool(), "unstake-sbtc-early", [Cl.principal(manager), Cl.uint(sats)]),
  /**
   * Recognise reward sBTC that has arrived but not been split yet.
   *
   * Permissionless, and worth making before leaving early: an early unstake
   * takes the member's shares out of the epoch, and anything unrecognised at
   * that moment is split among whoever is left instead.
   */
  syncRewards: () => call(pool(), "sync-rewards"),
  claimRewards: (member: string) =>
    call(pool(), "claim-rewards", [Cl.principal(member)]),
  claimPrincipal: (member: string) =>
    call(pool(), "claim-principal", [Cl.principal(member)]),
};

/**
 * An address as the bridge takes it: a version byte and a hash.
 *
 * The same shape pox-5 uses for a reward address, and the one thing every
 * bridge-v2 call is keyed on. `l1.ts` produces it from an address string;
 * nothing here parses bitcoin.
 */
export interface PoxAddress {
  version: string;
  hashbytes: string;
}

const addressTuple = (address: PoxAddress) =>
  Cl.tuple({
    version: Cl.bufferFromHex(strip(address.version)),
    hashbytes: Cl.bufferFromHex(strip(address.hashbytes)),
  });

/**
 * The L1 route, version 2.
 *
 * Version 1 committed to the *transaction*: a txid, which does not exist until
 * the transaction has been built and signed. Version 2 commits to the *address
 * the bitcoin will come from*, which the member already has -- so the two
 * Stacks calls come first and the bitcoin can then be sent by anything.
 */
export const bridgeCalls = {
  /** Commit to the address, and to how many sats will arrive from it. */
  commitAddress: (digest: string, sats: number, ustx: number) =>
    call(
      bridge(),
      "commit-btc-address",
      [Cl.bufferFromHex(strip(digest)), Cl.uint(sats)],
      // The commit takes the STX leg; the sats arrive later, on bitcoin.
      ustx > 0 ? [Pc.principal(signer()).willSendEq(ustx).ustx()] : undefined,
    ),
  /**
   * Name it, one burn block later. First reveal takes the address.
   *
   * Deny with nothing permitted. The reveal is bookkeeping -- it writes the
   * announcement, drops the commitment and prints; it moves no STX and no
   * sBTC, and the STX leg it names was taken at the commit. So the wallet is
   * told this transaction may move nothing at all, and will refuse to sign if
   * some future version of the contract, or a contract at this address that is
   * not the one intended, tries to.
   */
  revealAddress: (address: PoxAddress, salt: string) =>
    call(
      bridge(),
      "reveal-btc-address",
      [addressTuple(address), Cl.bufferFromHex(strip(salt))],
      [],
      "deny",
    ),
  /**
   * Credit the member, once the signers have swept it.
   *
   * `tx` and `parents` are the deposit transaction and the transaction behind
   * each of its inputs: the chain of txids is what proves, on chain, that the
   * bitcoin came from the revealed address.
   *
   * `ustx` is the STX leg the announcement was priced at, and the whole of what
   * this call moves: the bridge hands it to the pool, out of its own balance,
   * and the caller sends nothing. Naming it lets the call go out in deny mode
   * -- one transfer, from a named principal, for an exact amount, and any
   * other movement aborts the transaction.
   *
   * The condition is about the *bridge*, not the caller, which is what makes it
   * worth writing here: this call is permissionless, so the member is often not
   * the one signing it, and the amount a keeper's transaction moves out of the
   * bridge is the member's STX either way.
   *
   * The mode is `originator` either way, so the member is covered even when the
   * announcement cannot be read: whoever signs this moves nothing of their own,
   * and the bridge's leg is named on top of that when it is known. Where the
   * read fails the call still goes -- a deposit whose sats are already swept
   * has no way back, and refusing to credit it over a missing read would
   * strand it -- but it goes with the signer protected rather than with
   * everything permitted.
   */
  complete: (
    txid: string,
    voutIndex: number,
    tx: string,
    parents: string[],
    ustx?: number,
  ) =>
    call(
      bridge(),
      "complete-btc-deposit",
      [
        Cl.bufferFromHex(strip(txid)),
        Cl.uint(voutIndex),
        Cl.bufferFromHex(strip(tx)),
        Cl.list(parents.map((parent) => Cl.bufferFromHex(strip(parent)))),
      ],
      ustx !== undefined && ustx > 0
        ? [Pc.principal(`${config.deployer}.${config.bridge}`).willSendEq(ustx).ustx()]
        : [],
      "originator",
    ),
  /**
   * Take the STX leg back from a commitment that was never revealed.
   *
   * Originator mode with nothing permitted: the refund comes *out* of the
   * bridge, so the signer -- who may be a stranger clearing a lapsed
   * commitment -- has no business sending anything at all here.
   */
  cancelCommitment: (member: string, digest: string) =>
    call(
      bridge(),
      "cancel-btc-commitment",
      [Cl.principal(member), Cl.bufferFromHex(strip(digest))],
    ),
  /** …or from a revealed address the bitcoin never followed. Same shape. */
  cancelDeposit: (address: PoxAddress) =>
    call(bridge(), "cancel-btc-deposit", [addressTuple(address)]),
};

/** The STX leg the bound bond prices `sats` at. */
export const quote = (sats: number): Promise<Plain> =>
  readOnly(pool(), "get-required-ustx", [Cl.uint(sats)]);

/**
 * Who the sBTC deposit has to credit. A principal, not a bitcoin address:
 * an sBTC deposit names the Stacks account it mints to, and only the treasury
 * will do -- `complete-btc-deposit` refuses anything else.
 */
export const depositRecipient = (): Promise<Plain> =>
  readOnly(bridge(), "get-deposit-address");

/** What to commit to, computed by the contract so a client cannot disagree. */
export const addressDigest = (address: PoxAddress, salt: string): Promise<Plain> =>
  readOnly(bridge(), "get-address-digest", [
    addressTuple(address),
    Cl.bufferFromHex(strip(salt)),
  ]);

/**
 * The scriptPubKey the bridge would key an announcement on.
 *
 * `null` for an address shape it cannot take, which is the cheapest possible
 * way to tell a member that before they have committed anything.
 */
export const addressScript = (address: PoxAddress): Promise<Plain> =>
  readOnly(bridge(), "get-address-script", [addressTuple(address)]);

/** The STX leg the bridge itself prices `sats` at. */
export const bridgeQuote = (sats: number): Promise<Plain> =>
  readOnly(bridge(), "get-required-ustx", [Cl.uint(sats)]);

/**
 * Whether the sBTC signers have swept a deposit, as the *registry* has it.
 *
 * The same read `complete-btc-deposit` opens with, against the same contract,
 * so an answer of `null` here is exactly the `ERR_DEPOSIT_NOT_SWEPT (u304)`
 * that call would return. Asking first turns a signed transaction that reverts
 * into a sentence.
 *
 * The registry sits beside the token at the same deployer -- one address for
 * the whole sBTC deployment -- so it is named off `net().sbtc` rather than
 * configured again.
 */
export const sweptDeposit = (txid: string, voutIndex: number): Promise<Plain> => {
  const [address] = net().sbtc.split(".") as [string, string];
  return readOnly({ address, name: "sbtc-registry" }, "get-completed-deposit", [
    Cl.bufferFromHex(strip(txid)),
    Cl.uint(voutIndex),
  ]);
};

/** One thing the bridge did, as it printed it. */
export interface BridgeEvent {
  topic: string;
  /** The bitcoin transaction, where the event is about one. */
  txid: string;
  sats: number;
  ustx: number;
  /** The Stacks transaction that carried it, for a link to the explorer. */
  tx: string;
}

/**
 * This member's deposits, read back from what the bridge printed.
 *
 * There is no per-member index on chain -- the bridge keys its maps by script
 * and by txid, and neither is enumerable from a contract call -- so the
 * history is the event log, filtered here. That makes it a *recent* history
 * rather than a complete one: a member whose deposits are older than the page
 * asked for will not see them, and the card says so rather than implying the
 * list is everything.
 *
 * A proper history is an indexer's job. This is the honest cheap version: one
 * request, decoded in the page, filtered to the member who is asking.
 */
export async function bridgeHistory(
  member: string,
  limit = 50,
): Promise<BridgeEvent[]> {
  const id = `${config.deployer}.${config.bridge}`;
  const response = await fetch(
    `${apiBase()}/extended/v1/contract/${id}/events?limit=${limit}&offset=0`,
  );
  if (!response.ok) throw new Error(`The event log answered ${response.status}`);
  const body = (await response.json()) as {
    results?: { tx_id?: string; contract_log?: { value?: { hex?: string } } }[];
  };

  const out: BridgeEvent[] = [];
  for (const entry of body.results ?? []) {
    const hex = entry.contract_log?.value?.hex;
    if (!hex) continue;
    let printed: Plain;
    try {
      printed = plain(cvToValue(hexToCV(hex), true));
    } catch {
      continue;
    }
    const fields = printed as Record<string, Plain> | null;
    if (!fields || typeof fields !== "object") continue;
    if (String(fields["member"] ?? "") !== member) continue;
    const topic = String(fields["topic"] ?? "");
    if (!topic) continue;
    out.push({
      topic,
      txid: String(fields["txid"] ?? "").replace(/^0x/, ""),
      sats: num(fields["sats"] ?? 0),
      ustx: num(fields["ustx"] ?? 0),
      tx: String(entry.tx_id ?? ""),
    });
  }
  return out;
}

/** A commitment this member has made and not yet revealed, if any. */
export const commitmentFor = (member: string, digest: string): Promise<Plain> =>
  readOnly(bridge(), "get-commitment", [
    Cl.principal(member),
    Cl.bufferFromHex(strip(digest)),
  ]);

/** A revealed address the bitcoin has not arrived for yet, if any. */
export const announcementFor = (address: PoxAddress): Promise<Plain> =>
  readOnly(bridge(), "get-announcement", [addressTuple(address)]);

/** Whether a bitcoin output has already been credited to somebody. */
export const creditedDeposit = (txid: string, voutIndex: number): Promise<Plain> =>
  readOnly(bridge(), "get-credited-deposit", [
    Cl.bufferFromHex(strip(txid)),
    Cl.uint(voutIndex),
  ]);

/** `get-early-unstake-preview`: what leaving mid-term returns, and what it costs. */
export interface EarlyUnstake {
  /** The committed sBTC it would hand back. */
  sats: number;
  /** The STX leg, which the roll releases rather than this call. */
  "ustx-at-roll": number;
  /** Rewards already accrued to this member, which leaving does not touch. */
  "banked-rewards": number;
  /** Reward sBTC the pool holds but has not split yet, at this member's
   *  current weight. Forfeited unless `sync-rewards` runs first. */
  "at-risk-rewards": number;
}

export interface MemberPosition {
  settled: Record<string, Plain> | null;
  principal: Record<string, Plain> | null;
  rewards: number;
  sbtc: number;
  /** What an early exit would do, computed by the contract rather than here. */
  early: EarlyUnstake | null;
}

/** Everything the join panel says about the connected member. */
export async function loadMember(): Promise<MemberPosition | null> {
  if (!configured() || !account) return null;
  const [sbtcAddress, sbtcName] = net().sbtc.split(".") as [string, string];
  const [settled, principal, rewards, sbtc, early] = await Promise.all([
    readOnly(pool(), "get-settled-member", [Cl.principal(account)]),
    readOnly(pool(), "get-claimable-principal", [Cl.principal(account)]),
    readOnly(pool(), "get-claimable-rewards", [Cl.principal(account)]),
    readOnly({ address: sbtcAddress, name: sbtcName }, "get-balance", [
      Cl.principal(account),
    ]).catch(() => 0),
    // Only `vault-2` and later have it. A pool without one is not an error
    // here -- it is a pool the early exit is simply not offered on.
    readOnly(pool(), "get-early-unstake-preview", [Cl.principal(account)]).catch(
      () => null,
    ),
  ]);
  return {
    settled: settled as Record<string, Plain> | null,
    principal: principal as Record<string, Plain> | null,
    rewards: Number(rewards ?? 0),
    sbtc: Number(sbtc ?? 0),
    early: early as unknown as EarlyUnstake | null,
  };
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

/**
 * `get-stake-preview`: what the next `stake` would commit, and what holds it
 * back. The contract computes it, so the page never has to reproduce the
 * allocation cap, the STX floor or the launch floor in JavaScript.
 */
export interface StakePreview {
  /** Everything that wants in: committed, less those leaving, plus the queue. */
  "eligible-sats": number;
  /** What actually fits, once the allocation and the STX behind it are applied. */
  sats: number;
  ustx: number;
  "required-ustx": number;
  "short-ustx": number;
  scaled: boolean;
  "stx-limited": boolean;
  "allocation-limited": boolean;
  /**
   * The launch floor, on the vaults that have one. `bind-next-bond` takes no
   * `min-sats`, so a vault bound by it reports neither -- absent is no floor,
   * not a floor of zero that was missed.
   */
  "min-sats"?: number;
  "meets-floor"?: boolean;
}

/** A bond period as pox-5 describes it, whether or not the pool is in it. */
export interface BondPeriod {
  index: number;
  start: number;
  cycle: number;
  /** When the bond's own term ends and L1 collateral unlocks. */
  unlock: number;
  staked: number;
  /** This pool's allowance on it. `null` means it is not on the allowlist. */
  allowance: number | null;
  active: boolean;
}

export interface BondSchedule {
  /** The period that has most recently opened -- what is running now. */
  current: BondPeriod | null;
  /** The next one to open, which is the pool's next chance to bind. */
  next: BondPeriod;
}

/**
 * Where the chain is in pox-5's bond schedule.
 *
 * Read from pox-5 rather than the pool, because when nothing is bound the pool
 * has nothing to say -- and what a reader wants to know is what is running and
 * when the next chance comes.
 *
 * Bond periods are evenly spaced, so two reads give the whole schedule and the
 * indices fall out of arithmetic instead of walking one call at a time.
 */
export async function loadSchedule(burn: number): Promise<BondSchedule | null> {
  const [poxAddress, poxName] = net().pox.split(".") as [string, string];
  const pox = { address: poxAddress, name: poxName };
  const staker = `${config.deployer}.${config.pool}`;

  const heightOf = async (index: number) =>
    Number(await readOnly(pox, "bond-period-to-burn-height", [Cl.uint(index)]));

  const [first, second] = await Promise.all([heightOf(0), heightOf(1)]);
  const spacing = second - first;
  if (!Number.isFinite(spacing) || spacing <= 0) return null;

  const period = async (index: number): Promise<BondPeriod> => {
    const [start, cycle, unlock, staked, allowance, active] = await Promise.all([
      heightOf(index),
      readOnly(pox, "bond-period-to-reward-cycle", [Cl.uint(index)]),
      readOnly(pox, "get-bond-l1-unlock-height", [Cl.uint(index)]),
      readOnly(pox, "get-total-sbtc-staked-for-bond", [Cl.uint(index)]),
      readOnly(pox, "get-bond-allowance", [Cl.uint(index), Cl.principal(staker)]),
      readOnly(pox, "is-bond-active-at-height", [Cl.uint(index), Cl.uint(burn)]),
    ]);
    return {
      index,
      start,
      cycle: Number(cycle),
      unlock: Number(unlock),
      staked: Number(staked),
      allowance: allowance === null ? null : Number(allowance),
      active: active === true,
    };
  };

  const nextIndex = Math.max(0, Math.ceil((burn - first + 1) / spacing));
  const [next, current] = await Promise.all([
    period(nextIndex),
    nextIndex > 0 ? period(nextIndex - 1) : Promise.resolve(null),
  ]);
  return { current, next };
}

export interface PoolState {
  totals: Record<string, Plain> | null;
  live: LiveEpoch | null;
  config: Record<string, Plain> | null;
  /** The next bond, and where the chain is relative to its deadlines. */
  bond: BoundBond | null;
  /** What the next `stake` would commit against the bound bond's allocation. */
  preview: StakePreview | null;
  burn: number;
  /** Read from pox-5, so the page can say what is running even when unbound. */
  schedule: BondSchedule | null;
}

/**
 * The pool's own numbers: the stats in the header, and the bond behind the
 * countdown -- the one it is staked into, or the one it is waiting on.
 */
export async function loadPool(): Promise<PoolState | null> {
  if (!configured()) return null;
  const [totals, live, cfg, bond, preview, burn] = await Promise.all([
    readOnly(pool(), "get-pool"),
    readOnly(pool(), "get-live-epoch"),
    readOnly(pool(), "get-config"),
    readOnly(pool(), "get-bound-bond"),
    readOnly(pool(), "get-stake-preview"),
    burnHeight(),
  ]);
  return {
    totals: totals as Record<string, Plain> | null,
    live: live as unknown as LiveEpoch | null,
    config: cfg as Record<string, Plain> | null,
    bond: bond as unknown as BoundBond | null,
    preview: preview as unknown as StakePreview | null,
    burn,
    schedule: await loadSchedule(burn).catch(() => null),
  };
}
