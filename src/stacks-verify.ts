// Checking a Stacks wallet's signature without stacks.js.
//
// A chat identity is tied to a pool member by one signed message: the wallet
// signs a text naming the chat key, and anyone can recover the signer's
// address from the signature and compare. Every reader of the chat has to make
// that check to know who is a member -- and most readers never connect a
// wallet, so the check cannot live in `chain.ts`, which costs 1.4 MB to load.
//
// What it takes is small: secp256k1 recovery, sha256, ripemd160 and the c32
// address alphabet. The curve and hash libraries are already in the bundle for
// the chat's own keys, so this is a few hundred bytes on top rather than the
// whole SDK. `smoke-test.ts` checks every function here against stacks.js
// itself, so an encoding detail drifting would fail the build.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";

/// --- bytes ----------------------------------------------------------------------

export const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error("bad hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/// --- c32 addresses ---------------------------------------------------------------

const C32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Single-sig address versions: 22 on mainnet, 26 everywhere else. */
export const VERSION_MAINNET = 22;
export const VERSION_TESTNET = 26;

/**
 * c32 encoding as c32check does it: the bytes read as one big number in base
 * 32, then one leading `0` for every leading zero byte -- which is what keeps
 * the encoding reversible.
 */
function c32encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let digits = "";
  while (n > 0n) {
    digits = C32[Number(n & 31n)] + digits;
    n >>= 5n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return "0".repeat(zeros) + digits;
}

function c32decode(text: string): Uint8Array {
  let n = 0n;
  for (const ch of text) {
    const v = C32.indexOf(ch);
    if (v < 0) throw new Error("bad c32 character");
    n = (n << 5n) | BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "0") zeros++;
  return new Uint8Array([...new Array<number>(zeros).fill(0), ...bytes]);
}

/** A Stacks address from its version byte and hash160. */
export function c32address(version: number, hash160: Uint8Array): string {
  const payload = concat(new Uint8Array([version]), hash160);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  return `S${C32[version]}${c32encode(concat(hash160, checksum))}`;
}

/** The version and hash160 inside an address, or null if it does not check. */
export function decodeAddress(address: string): { version: number; hash160: Uint8Array } | null {
  try {
    // Stacks addresses are written in upper case; c32check itself is not
    // case-sensitive, and a wallet may hand one back in either.
    const text = address.toUpperCase();
    if (text[0] !== "S" || text.length < 10) return null;
    const version = C32.indexOf(text[1]);
    if (version < 0) return null;
    const body = c32decode(text.slice(2));
    if (body.length < 5) return null;
    const hash160 = body.slice(0, body.length - 4);
    const checksum = body.slice(body.length - 4);
    if (hash160.length !== 20) return null;
    const expected = sha256(sha256(concat(new Uint8Array([version]), hash160))).slice(0, 4);
    if (expected.some((b, i) => b !== checksum[i])) return null;
    return { version, hash160 };
  } catch {
    return null;
  }
}

/** The address a compressed public key has on a network. */
export function addressOf(publicKey: Uint8Array, version: number): string {
  return c32address(version, ripemd160(sha256(publicKey)));
}

/// --- signed messages --------------------------------------------------------------

/**
 * `stx_signMessage` signs sha256 of the message under a fixed prefix and a
 * Bitcoin-style varint of its length -- SIP-018's plain-text form, as
 * `@stacks/encryption`'s `hashMessage` builds it.
 */
const PREFIX = "\x17Stacks Signed Message:\n";

function varint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, n >> 8]);
  return new Uint8Array([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}

export function hashMessage(message: string): Uint8Array {
  const body = utf8(message);
  return sha256(concat(utf8(PREFIX), varint(body.length), body));
}

/**
 * Who signed `message`, as the address on `network`, or null if the signature
 * is not a valid recoverable signature over it.
 *
 * Wallets return RSV: 64 bytes of r‖s then the recovery byte. Some write that
 * byte as 27+, the Bitcoin way; both are accepted.
 */
export function signerOf(message: string, signatureHex: string, version: number): string | null {
  try {
    const bytes = hexToBytes(signatureHex);
    if (bytes.length !== 65) return null;
    let v = bytes[64];
    if (v >= 27) v -= 27;
    if (v > 3) return null;
    const sig = secp256k1.Signature.fromBytes(bytes.slice(0, 64), "compact").addRecoveryBit(v);
    const point = sig.recoverPublicKey(hashMessage(message));
    return addressOf(point.toBytes(true), version);
  } catch {
    return null;
  }
}

/**
 * Whether `signatureHex` is `address`'s signature over `message`.
 *
 * Recovery first, and if that does not land on the address, the public key the
 * wallet returned alongside -- a wallet that gets the recovery byte wrong still
 * produces a signature that verifies against the key it named, and that key
 * still has to hash to the address, so nothing is given away by trying it.
 */
export function verifyAddressSignature(
  message: string,
  signatureHex: string,
  address: string,
  publicKeyHex?: string,
): boolean {
  const decoded = decodeAddress(address);
  if (!decoded) return false;
  const claimed = address.toUpperCase();
  if (signerOf(message, signatureHex, decoded.version) === claimed) return true;
  if (!publicKeyHex) return false;
  try {
    const pub = hexToBytes(publicKeyHex);
    if (addressOf(pub, decoded.version) !== claimed) return false;
    const bytes = hexToBytes(signatureHex);
    if (bytes.length !== 65) return false;
    return secp256k1.verify(bytes.slice(0, 64), hashMessage(message), pub, {
      prehash: false,
      lowS: false,
    });
  } catch {
    return false;
  }
}

/// --- just enough Clarity ----------------------------------------------------------

// The chat asks the pool one question about an address -- is it a member --
// and that is a read-only call with a principal in and a tuple out. Encoding
// one and decoding the other is short enough not to be worth the SDK.

/** A standard principal, serialised for `call-read`. */
export function principalHex(address: string): string | null {
  const decoded = decodeAddress(address);
  if (!decoded) return null;
  return `0x05${decoded.version.toString(16).padStart(2, "0")}${bytesToHex(decoded.hash160)}`;
}

export type Lite =
  | bigint
  | boolean
  | null
  | string
  | Lite[]
  | { [key: string]: Lite };

/**
 * Decode a serialised Clarity value into plain data: ints as bigint, tuples as
 * objects, optionals and responses unwrapped the way `cvToValue` flattens them
 * -- `none` to null, `some x` / `ok x` / `err x` to x.
 */
export function decodeClarity(hex: string): Lite {
  const bytes = hexToBytes(hex);
  let at = 0;
  const take = (n: number): Uint8Array => {
    if (at + n > bytes.length) throw new Error("truncated");
    const out = bytes.slice(at, at + n);
    at += n;
    return out;
  };
  const u32 = (): number => {
    const b = take(4);
    return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  };
  const read = (): Lite => {
    const type = take(1)[0];
    switch (type) {
      case 0x00: {
        const b = take(16);
        let n = 0n;
        for (const x of b) n = (n << 8n) | BigInt(x);
        return BigInt.asIntN(128, n);
      }
      case 0x01: {
        const b = take(16);
        let n = 0n;
        for (const x of b) n = (n << 8n) | BigInt(x);
        return n;
      }
      case 0x02:
        return `0x${bytesToHex(take(u32()))}`;
      case 0x03:
        return true;
      case 0x04:
        return false;
      case 0x05: {
        const b = take(21);
        return c32address(b[0], b.slice(1));
      }
      case 0x06: {
        const b = take(21);
        const name = new TextDecoder().decode(take(take(1)[0]));
        return `${c32address(b[0], b.slice(1))}.${name}`;
      }
      case 0x07:
      case 0x08:
      case 0x0a:
        return read();
      case 0x09:
        return null;
      case 0x0b: {
        const n = u32();
        const out: Lite[] = [];
        for (let i = 0; i < n; i++) out.push(read());
        return out;
      }
      case 0x0c: {
        const n = u32();
        const out: Record<string, Lite> = {};
        for (let i = 0; i < n; i++) {
          const key = new TextDecoder().decode(take(take(1)[0]));
          out[key] = read();
        }
        return out;
      }
      case 0x0d:
      case 0x0e:
        return new TextDecoder().decode(take(u32()));
      default:
        throw new Error(`clarity type ${type} not handled`);
    }
  };
  return read();
}
