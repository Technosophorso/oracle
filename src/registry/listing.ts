// Tool/agent listing schema (spec §4.3): "what the tool does, its
// interface/schema, how to invoke it, who published it (signed by the
// publisher's keypair)."
//
// Signing here reuses the SAME secp256k1 keypair as the coordination layer
// (spec §4.1: "the same keypair signs messages on the coordination layer
// and listings on the registry layer"). The signature scheme is BIP-340
// Schnorr over sha256(canonical JSON) — identical primitive to how
// nostr-tools signs Nostr events — so a listing's authenticity is
// verifiable by anyone with just the publisher's pubkey, independently of
// whatever wallet/mechanism actually pays to store the bytes on Arweave
// (see arweave.ts: storage payment and content authorship are separate
// concerns on purpose).

import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { secretKeyBytes, type Identity } from "../identity/keys.js";

export const LISTING_SCHEMA_VERSION = "oracle-listing/1";

export type ListingKind = "tool" | "agent";

/**
 * How to actually invoke the thing being listed. Deliberately open-ended —
 * the protocol doesn't mandate a transport. `spec` is transport-specific
 * (e.g. a JSON Schema for an HTTP tool's request/response body, an MCP
 * server URL, a Nostr pubkey to DM, ...). See docs/REGISTRY.md.
 */
export interface ListingInterface {
  transport: string;
  spec: unknown;
}

/** Fields the publisher fills in and signs. */
export interface ListingContent {
  schemaVersion: typeof LISTING_SCHEMA_VERSION;
  kind: ListingKind;
  name: string;
  description: string;
  /** Free-text keywords for discovery (Phase 3 indexing). */
  capabilities: string[];
  interface: ListingInterface;
  /** Publisher's public key, hex-encoded — same identity as the coordination layer. */
  publisher: string;
  /** ISO-8601 creation timestamp, set by the publisher (not trusted as authoritative order — Arweave's own record is). */
  createdAt: string;
}

export interface SignedListing extends ListingContent {
  /** BIP-340 Schnorr signature, hex-encoded, over sha256(canonicalize(content)). */
  signature: string;
}

/**
 * Deterministic JSON serialization: object keys sorted recursively so the
 * same logical content always signs/verifies identically regardless of
 * property insertion order. Arrays keep their given order (order is
 * meaningful there).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function hashContent(content: ListingContent): Uint8Array {
  return sha256(new TextEncoder().encode(canonicalize(content)));
}

/** Build and sign a listing. `publisher` and `schemaVersion` are filled in for you. */
export function createListing(
  identity: Identity,
  fields: Omit<ListingContent, "publisher" | "schemaVersion">,
): SignedListing {
  const content: ListingContent = {
    schemaVersion: LISTING_SCHEMA_VERSION,
    publisher: identity.publicKeyHex,
    ...fields,
  };
  const signature = Buffer.from(
    schnorr.sign(hashContent(content), secretKeyBytes(identity)),
  ).toString("hex");
  return { ...content, signature };
}

/**
 * Verify a listing's signature against its own embedded publisher pubkey.
 * Callers are responsible for deciding, separately, whether they trust
 * that pubkey (spec §4.5 — trust is a client-side concern, not enforced
 * here). This only proves "the holder of this pubkey signed exactly this
 * content," nothing more.
 */
export function verifyListing(listing: SignedListing): boolean {
  const { signature, ...content } = listing;
  if (listing.schemaVersion !== LISTING_SCHEMA_VERSION) return false;
  try {
    return schnorr.verify(
      Buffer.from(signature, "hex"),
      hashContent(content as ListingContent),
      Buffer.from(listing.publisher, "hex"),
    );
  } catch {
    return false;
  }
}
