// .well-known/agent-marketplace.json — the domain-level discovery
// convention (spec-adjacent, not part of the wire protocol itself). Same
// idea as .well-known/mcp.json or OpenAPI's well-known discovery files:
// any domain that wants to expose itself to agent tooling puts one static
// JSON file at a predictable path, and agent frameworks that already know
// to look for .well-known/* conventions pick it up automatically.
//
// This complements, rather than replaces, NIP-11 relay self-description
// (docs/RELAY-INFO.md): NIP-11 describes a specific relay; this describes
// an organization/operator's overall presence in the marketplace — which
// relays they run, which registry backend they use, and how someone can
// start participating starting from nothing but this one file (see
// "reflexive propagation" in docs/nips/NIP-XX-agent-marketplace.md).

export const WELL_KNOWN_PATH = ".well-known/agent-marketplace.json";
export const WELL_KNOWN_FORMAT_VERSION = "oracle-well-known/1";

export interface WellKnownDocument {
  formatVersion: typeof WELL_KNOWN_FORMAT_VERSION;
  name: string;
  description?: string;
  /** Nostr relay URLs this operator runs or recommends for the coordination layer. */
  relays: string[];
  /** What permanent store listings live on. "arweave" for the reference implementation; the NIP is backend-agnostic (see docs/nips/NIP-XX-agent-marketplace.md). */
  registryBackend: string;
  /** A handful of real listing ids, so an arriving agent can bootstrap and sanity-check its own discovery index immediately (see docs/DISCOVERY.md). */
  sampleListingTxIds: string[];
  /** Where to read how to publish your own listing/participate — a URL or a doc path, resolved relative to wherever this file is hosted. */
  howToPublish: string;
  /** Pointers to the protocol documents, so this one file is enough to find everything else. */
  docs: {
    nip: string;
    protocol: string;
    registry: string;
    discovery: string;
    trust?: string;
    verification?: string;
  };
}

export interface WellKnownOptions {
  name: string;
  description?: string;
  relays: string[];
  registryBackend?: string;
  sampleListingTxIds?: string[];
  howToPublish: string;
  docs: WellKnownDocument["docs"];
}

export function buildWellKnown(opts: WellKnownOptions): WellKnownDocument {
  return {
    formatVersion: WELL_KNOWN_FORMAT_VERSION,
    name: opts.name,
    description: opts.description,
    relays: opts.relays,
    registryBackend: opts.registryBackend ?? "arweave",
    sampleListingTxIds: opts.sampleListingTxIds ?? [],
    howToPublish: opts.howToPublish,
    docs: opts.docs,
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate an arbitrary domain's .well-known/agent-marketplace.json.
 * Deliberately permissive about unknown extra fields (forward
 * compatibility) — only flags missing/malformed required fields.
 */
export function validateWellKnown(doc: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof doc !== "object" || doc === null) {
    return { valid: false, errors: ["not a JSON object"] };
  }
  const d = doc as Record<string, unknown>;

  if (d.formatVersion !== WELL_KNOWN_FORMAT_VERSION) {
    errors.push(`formatVersion must be "${WELL_KNOWN_FORMAT_VERSION}"`);
  }
  if (typeof d.name !== "string" || d.name.length === 0) errors.push("name is required");
  if (!Array.isArray(d.relays) || !d.relays.every((r) => typeof r === "string")) {
    errors.push("relays must be an array of strings");
  }
  if (typeof d.registryBackend !== "string") errors.push("registryBackend is required");
  if (!Array.isArray(d.sampleListingTxIds)) errors.push("sampleListingTxIds must be an array");
  if (typeof d.howToPublish !== "string" || d.howToPublish.length === 0) {
    errors.push("howToPublish is required");
  }
  if (typeof d.docs !== "object" || d.docs === null) {
    errors.push("docs is required");
  } else {
    const docs = d.docs as Record<string, unknown>;
    for (const key of ["nip", "protocol", "registry", "discovery"]) {
      if (typeof docs[key] !== "string") errors.push(`docs.${key} is required`);
    }
  }

  return { valid: errors.length === 0, errors };
}
