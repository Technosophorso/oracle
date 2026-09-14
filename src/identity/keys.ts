// Identity = a secp256k1 keypair. Same key signs Nostr coordination events
// (NIP-01) and, later, registry listings — see spec §4.1.
//
// No account, no registry of "who's allowed." Minting a new identity is
// free and expected to happen constantly at scale (spec §4.1) — this
// module deliberately has no concept of a canonical/registered identity.

import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { readFileSync, writeFileSync } from "node:fs";

export interface Identity {
  /** 32-byte secret key, hex-encoded. Never share or publish this. */
  secretKeyHex: string;
  /** 32-byte x-only public key, hex-encoded. This is the agent's public identity. */
  publicKeyHex: string;
  /** bech32 nsec — human-friendly secret key encoding (NIP-19). */
  nsec: string;
  /** bech32 npub — human-friendly public key encoding (NIP-19). */
  npub: string;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/** Mint a brand-new identity. Cheap and disposable by design. */
export function createIdentity(): Identity {
  const secretKey = generateSecretKey();
  return identityFromSecretKey(secretKey);
}

export function identityFromSecretKey(secretKey: Uint8Array): Identity {
  const publicKey = getPublicKey(secretKey);
  return {
    secretKeyHex: toHex(secretKey),
    publicKeyHex: publicKey,
    nsec: nip19.nsecEncode(secretKey),
    npub: nip19.npubEncode(publicKey),
  };
}

/** Restore an identity from its hex-encoded secret key. */
export function loadIdentityFromHex(secretKeyHex: string): Identity {
  return identityFromSecretKey(fromHex(secretKeyHex));
}

/** Restore an identity from its bech32 nsec. */
export function loadIdentityFromNsec(nsec: string): Identity {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") {
    throw new Error(`expected nsec, got ${decoded.type}`);
  }
  return identityFromSecretKey(decoded.data);
}

/**
 * Persist an identity to a local JSON file. This is reference-client
 * convenience only — the protocol has no concept of a "saved" identity.
 * Callers are responsible for keeping this file private (see .gitignore:
 * *.identity.json is excluded by default).
 */
export function saveIdentity(identity: Identity, filePath: string): void {
  writeFileSync(filePath, JSON.stringify(identity, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function loadIdentity(filePath: string): Identity {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Identity;
  return loadIdentityFromHex(parsed.secretKeyHex);
}

/** Get the raw secret key bytes needed by nostr-tools' event signer. */
export function secretKeyBytes(identity: Identity): Uint8Array {
  return fromHex(identity.secretKeyHex);
}
