// The bitcoin side of the L1 route.
//
// Everything here is about the deposit itself -- the address it comes from, the
// address it goes to, and reading the transaction back afterwards. The Stacks
// half of the same route is `chain.ts`; this module is kept apart from it
// because it is the heaviest thing the site loads and the fewest visitors need
// it, so it is imported only when a member actually works the L1 card.
//
// Three things it does that are worth knowing about before reading the code:
//
//   an address becomes {version, hashbytes}  -- the pox shape the bridge takes.
//     Decoded with @scure/btc-signer rather than by hand, and checked against
//     the bridge's own `get-address-script` before anything is committed.
//
//   a deposit address is derived                -- an sBTC deposit is not a
//     transfer to a principal; it is bitcoin sent to a taproot address whose
//     script tree commits to the recipient. `sbtc` builds it, because the
//     script format is protocol and not something to reproduce here.
//
//   the deposit is registered with Emily        -- sBTC signers do not watch
//     bitcoin for deposits, they are told. Nothing sweeps a deposit nobody
//     announced, so this step is not optional and its absence is not silent.
import * as btc from "@scure/btc-signer";
import { buildSbtcDepositAddress } from "sbtc";
import { bitcoin, net } from "./config.js";

/**
 * How long the reclaim path waits, and what the signers may take.
 *
 * The sBTC defaults, named here because both are baked into the address: a
 * deposit built with different numbers is a different address, and the member's
 * own reclaim path depends on the lock time being the one the signers expect.
 */
export const RECLAIM_LOCK_TIME = 950;
export const MAX_SIGNER_FEE = 80_000;

/** What `@scure/btc-signer` needs to know about the chain being addressed. */
const CHAINS = {
  mainnet: {
    bech32: "bc",
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
    bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  },
  testnet: {
    bech32: "tb",
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
    bip32: { public: 0x043587cf, private: 0x04358394 },
  },
  regtest: {
    bech32: "bcrt",
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
    bip32: { public: 0x043587cf, private: 0x04358394 },
  },
} as const;

const chain = () => CHAINS[bitcoin().chain];

/** An address as the bridge stores it: a version byte and a hash. */
export interface PoxAddress {
  /** Hex, one byte. 0x00 p2pkh, 0x01–0x03 p2sh, 0x04 p2wpkh, 0x05 p2wsh, 0x06 p2tr. */
  version: string;
  /** Hex, 20 or 32 bytes depending on the shape. */
  hashbytes: string;
}

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * `tb1q…` -> `{version, hashbytes}`.
 *
 * The five shapes the bridge's `get-address-script` knows, and nothing else:
 * an address it cannot turn into a scriptPubKey cannot be announced, and the
 * member finds that out here rather than from a reverted reveal.
 *
 * p2sh-wrapped segwit is version 0x01 like any other p2sh, which is what it is
 * on the chain -- the wrapping only shows up in the redeem script, which the
 * scriptPubKey does not carry.
 */
export function decodeAddress(address: string): PoxAddress {
  const parsed = btc.Address(chain()).decode(address.trim());
  switch (parsed.type) {
    case "pkh":
      return { version: "00", hashbytes: hex(parsed.hash) };
    case "sh":
      return { version: "01", hashbytes: hex(parsed.hash) };
    case "wpkh":
      return { version: "04", hashbytes: hex(parsed.hash) };
    case "wsh":
      return { version: "05", hashbytes: hex(parsed.hash) };
    case "tr":
      return { version: "06", hashbytes: hex(parsed.pubkey) };
    default:
      throw new Error(`This bridge cannot take a ${parsed.type} address`);
  }
}

/**
 * `{version, hashbytes}` -> `bcrt1q…`. The inverse of `decodeAddress`.
 *
 * The bridge's events carry the pox shape, not an address, and every bitcoin
 * API is asked for an address -- so anything reading the log back has to spell
 * it again. Encoded on the configured chain, which is what makes the answer a
 * link a reader can follow rather than a hash.
 *
 * Throws for a version this chain has no address for, which is a version the
 * bridge could not have taken an announcement for either.
 */
export function encodeAddress(address: PoxAddress): string {
  const version = address.version.replace(/^0x/, "").toLowerCase();
  const bytes = hexToBytes(address.hashbytes);
  const encoder = btc.Address(chain());
  const encode = (out: Parameters<typeof encoder.encode>[0]) => encoder.encode(out);
  // p2sh and the two p2sh-wrapped segwit versions are one script on the chain,
  // so they are one address here -- the wrapping only shows up in the redeem
  // script, which the scriptPubKey does not carry.
  if (version === "00") return encode({ type: "pkh", hash: bytes });
  if (version === "01" || version === "02" || version === "03") {
    return encode({ type: "sh", hash: bytes });
  }
  if (version === "04") return encode({ type: "wpkh", hash: bytes });
  if (version === "05") return encode({ type: "wsh", hash: bytes });
  if (version === "06") return encode({ type: "tr", pubkey: bytes });
  throw new Error(`No address on this chain has version 0x${version}`);
}

/** Whether an address parses at all, for saying so as it is typed. */
export function readAddress(address: string): PoxAddress | null {
  try {
    return decodeAddress(address);
  } catch {
    return null;
  }
}

/**
 * The signers' aggregate key, from the sBTC deployment this pool's token
 * belongs to.
 *
 * Read from chain rather than configured: it rotates, and a deposit built
 * against a stale key is one the current signer set cannot spend. 33 bytes
 * compressed on the wire, 32 in a taproot script -- the parity byte goes.
 */
export async function signersPublicKey(read: Reader): Promise<string> {
  const [address] = net().sbtc.split(".") as [string, string];
  const key = String(await read({ address, name: "sbtc-registry" }, "get-current-aggregate-pubkey"));
  const bare = key.replace(/^0x/, "");
  if (bare.length === 66) return bare.slice(2);
  if (bare.length === 64) return bare;
  throw new Error(`The sBTC registry returned a ${bare.length / 2}-byte signer key`);
}

/** Just enough of `chain.ts` to make one read, without importing it. */
type Reader = (
  contract: { address: string; name: string },
  fn: string,
) => Promise<unknown>;

export interface DepositAddress {
  address: string;
  depositScript: string;
  reclaimScript: string;
  /**
   * The five values the address is built from, carried back out with it.
   *
   * Not decoration: an address nobody can rebuild is an address that has to be
   * taken on trust, and these are exactly what an independent tool asks for.
   * The signers' key and the max fee live in the deposit leaf, the reclaim key
   * and the lock time in the reclaim leaf.
   */
  recipient: string;
  signersPublicKey: string;
  reclaimPublicKey: string;
  maxSignerFee: number;
  reclaimLockTime: number;
}

/**
 * Where the bitcoin goes.
 *
 * Not the treasury's own address -- the treasury is a Stacks contract and has
 * none. An sBTC deposit is bitcoin sent to a one-off taproot address whose
 * script tree holds two leaves: one the signers can spend, which names the
 * principal to credit, and one the member can spend after `RECLAIM_LOCK_TIME`
 * blocks if the signers never do. That second leaf is why `reclaimPublicKey`
 * has to be the member's own key and not a placeholder.
 */
export function depositAddress(opts: {
  recipient: string;
  signersPublicKey: string;
  reclaimPublicKey: string;
}): DepositAddress {
  const built = buildSbtcDepositAddress({
    network: { ...chain(), bip84: { coin: 1 }, magicBytes: "T2" },
    stacksAddress: opts.recipient,
    signersPublicKey: opts.signersPublicKey,
    reclaimPublicKey: opts.reclaimPublicKey,
    maxSignerFee: MAX_SIGNER_FEE,
    reclaimLockTime: RECLAIM_LOCK_TIME,
  });
  return {
    address: built.address,
    depositScript: built.depositScript,
    reclaimScript: built.reclaimScript,
    recipient: opts.recipient,
    signersPublicKey: opts.signersPublicKey,
    reclaimPublicKey: opts.reclaimPublicKey,
    maxSignerFee: MAX_SIGNER_FEE,
    reclaimLockTime: RECLAIM_LOCK_TIME,
  };
}

/** An x-only key, from whatever shape the wallet handed over. */
export function xOnly(publicKey: string): string {
  const bare = publicKey.replace(/^0x/, "");
  if (bare.length === 66) return bare.slice(2);
  if (bare.length === 64) return bare;
  throw new Error("The wallet did not give a bitcoin public key to reclaim with");
}

/// --- reading bitcoin back ------------------------------------------------------

const api = (): string => {
  const { api: base } = bitcoin();
  if (!base) {
    throw new Error(
      "This page has no bitcoin API configured for this network, so it cannot " +
        "read the deposit back. Pass ?btcApi= or fill in NETWORKS in config.ts.",
    );
  }
  return base;
};

/**
 * A read from that API, with the reason it failed said in full.
 *
 * A 404 here is worth a sentence rather than a status code, because the likely
 * cause is not a wrong txid: the API has to index the *same* bitcoin the page
 * is addressing, and the two can disagree silently. Stacks testnet's burnchain
 * is a private regtest, which a public explorer cannot see into at all -- so a
 * transaction that certainly exists reads as missing, and nothing about
 * "404" says which of those two it is.
 */
const text = async (path: string): Promise<string> => {
  let response: Response;
  try {
    response = await fetch(`${api()}${path}`);
  } catch (error) {
    throw new Error(
      `${api()} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (response.status === 404) {
    throw new Error(
      `${api()} has no record of ${path.split("/")[2] ?? path}. It indexes bitcoin ` +
        `${bitcoin().chain === "regtest" ? "chains it can see, and a private regtest is not one" : `on another chain`}` +
        ` — point the page at an explorer for this chain with ?btcApi= and try again.`,
    );
  }
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return (await response.text()).trim();
};

/** The raw transaction, which is what both Emily and the bridge are given. */
export const rawTx = (txid: string): Promise<string> =>
  text(`/tx/${txid.replace(/^0x/, "")}/hex`);


/** A transaction that spent from an announced address, as esplora reports it. */
export interface FundingTx {
  txid: string;
  /** The burn height it confirmed at, or null while it is still in a mempool. */
  height: number | null;
  /**
   * Whether every input is locked to the announced address.
   *
   * `complete-btc-deposit` checks exactly this and refuses anything else, so a
   * transaction that fails it is not a deposit the bridge will credit however
   * much it paid -- and saying so is cheaper than a reverted transaction.
   */
  fromAddressOnly: boolean;
  /** Its outputs, less the change that went straight back to the address. */
  outputs: { index: number; sats: number; address: string; taproot: boolean }[];
}

/**
 * What was spent out of `address`, most recent first.
 *
 * This is how a deposit is found by someone who is not the member who sent it.
 * The bridge stores no txid until the deposit is credited -- the announcement
 * is keyed by the funding script alone -- so the only way to ask "has the
 * bitcoin arrived for this announcement" is to look at the address the
 * announcement named and see what left it.
 *
 * Esplora answers with the most recent chain of transactions rather than all
 * of them, which is the same honest limit the event log has: a deposit older
 * than that page is not found here, and nothing pretends otherwise.
 */
export async function fundingTxs(address: string): Promise<FundingTx[]> {
  const seen = (await json(`/address/${address}/txs`)) as EsploraTx[];
  return seen
    .filter((tx) =>
      (tx.vin ?? []).some((input) => input.prevout?.scriptpubkey_address === address),
    )
    .map((tx) => ({
      txid: tx.txid,
      height: tx.status?.confirmed ? (tx.status.block_height ?? null) : null,
      fromAddressOnly: (tx.vin ?? []).every(
        (input) => input.prevout?.scriptpubkey_address === address,
      ),
      outputs: (tx.vout ?? [])
        .map((out, index) => ({
          index,
          sats: out.value ?? 0,
          address: out.scriptpubkey_address ?? "",
          taproot: out.scriptpubkey_type === "v1_p2tr",
        }))
        // Change back to the funding address is not a deposit to anywhere, and
        // an sBTC deposit is always the taproot output -- so what is left is
        // the short list worth asking the registry about.
        .filter((out) => out.address !== address),
    }));
}

/** Only the fields of esplora's transaction this page reads. */
interface EsploraTx {
  txid: string;
  status?: { confirmed?: boolean; block_height?: number };
  vin?: { prevout?: { scriptpubkey_address?: string } }[];
  vout?: { value?: number; scriptpubkey_address?: string; scriptpubkey_type?: string }[];
}

/** The same read as `text`, for the endpoints that answer with JSON. */
const json = async (path: string): Promise<unknown> => JSON.parse(await text(path));

/**
 * Which output of `txid` pays `address`, for the vout every later step needs.
 *
 * Read from the transaction itself rather than remembered from the send: a
 * wallet decides its own output order, and the change output is as likely to be
 * first as not.
 */
export async function outputIndex(txid: string, address: string): Promise<number> {
  // Compared as scriptPubKeys rather than as addresses: a transaction's outputs
  // are scripts, and re-encoding each one back into an address only introduces
  // a shape this build of the encoder happens to spell differently.
  const wanted = hex(btc.OutScript.encode(btc.Address(chain()).decode(address)));
  const tx = parse(await rawTx(txid));
  for (let index = 0; index < tx.outputsLength; index++) {
    const script = tx.getOutput(index)?.script;
    if (script && hex(script) === wanted) return index;
  }
  throw new Error(`That transaction has no output paying ${address}`);
}

/**
 * Deserialize a transaction that this page did not build.
 *
 * Every check off: the parser is being used as a reader, and a real transaction
 * is free to pay a bare pubkey, a script nothing here recognises, or anything
 * else that would fail a sanity check meant for transactions being *signed*.
 */
const parse = (raw: string) =>
  btc.Transaction.fromRaw(hexToBytes(raw), {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
    disableScriptCheck: true,
    allowLegacyWitnessUtxo: true,
  });

/**
 * The parent transaction behind every input, in input order.
 *
 * `complete-btc-deposit` proves whose bitcoin it was by reading the scriptPubKey
 * each input spends, and an input carries only a txid and an index -- so the
 * transaction that made that output has to be handed over with it. The bridge
 * takes at most eight, which is also the most inputs a deposit it will credit
 * can have.
 */
export async function parents(raw: string): Promise<string[]> {
  const tx = parse(raw);
  if (tx.inputsLength > 8) {
    throw new Error(
      `That transaction has ${tx.inputsLength} inputs and the bridge takes at most 8. ` +
        "Consolidate first, or send from fewer coins.",
    );
  }
  const ids: string[] = [];
  for (let index = 0; index < tx.inputsLength; index++) {
    const input = tx.getInput(index);
    if (!input?.txid) throw new Error("That transaction's inputs could not be read");
    ids.push(hex(input.txid));
  }
  return Promise.all(ids.map((id) => rawTx(id)));
}

const hexToBytes = (value: string): Uint8Array => {
  const bare = value.replace(/^0x/, "");
  const out = new Uint8Array(bare.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bare.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/// --- telling the signers -------------------------------------------------------

export interface EmilyDeposit {
  status?: string;
  statusMessage?: string;
  bitcoinTxid?: string;
  bitcoinTxOutputIndex?: number;
  error?: string;
  message?: string;
}

/**
 * Register a deposit with Emily, which is how the signers hear about it.
 *
 * The one step in the whole route that is neither bitcoin nor Stacks. A deposit
 * that is never registered is never swept: the bitcoin sits at the taproot
 * address until the reclaim path opens, ~`RECLAIM_LOCK_TIME` blocks later. So
 * this throws rather than shrugging where there is no Emily to tell -- and the
 * card does not offer to send bitcoin before there is one.
 */
export async function notify(deposit: {
  txid: string;
  vout: number;
  depositScript: string;
  reclaimScript: string;
  raw: string;
}): Promise<EmilyDeposit> {
  const { emily } = bitcoin();
  if (!emily) {
    throw new Error(
      "This page has no sBTC deposit API configured for this network. Registering " +
        "the deposit is what makes the signers sweep it, so nothing here would " +
        "reach them. Pass ?emily= or fill in NETWORKS in config.ts.",
    );
  }
  const response = await fetch(`${emily}/deposit`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      bitcoinTxid: deposit.txid.replace(/^0x/, ""),
      bitcoinTxOutputIndex: deposit.vout,
      depositScript: deposit.depositScript,
      reclaimScript: deposit.reclaimScript,
      transactionHex: deposit.raw,
    }),
  });
  const body = (await response.json()) as EmilyDeposit;
  if (!response.ok) {
    throw new Error(body?.message ?? body?.error ?? `Emily answered ${response.status}`);
  }
  return body;
}

/** What Emily says about a deposit already registered, for the wait. */
export async function depositStatus(txid: string, vout: number): Promise<EmilyDeposit | null> {
  const { emily } = bitcoin();
  if (!emily) return null;
  const response = await fetch(`${emily}/deposit/${txid.replace(/^0x/, "")}/${vout}`);
  if (!response.ok) return null;
  return (await response.json()) as EmilyDeposit;
}
