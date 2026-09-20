// NIP-11 relay information document, plus a marketplace-specific
// extension for reflexive propagation.
//
// NIP-11 (https://github.com/nostr-protocol/nips/blob/master/11.md) lets
// a relay describe itself over plain HTTP GET (Accept:
// application/nostr+json) at the same URL used for the WebSocket
// connection. This is the mechanism that makes a relay self-describing
// rather than requiring prior knowledge: a generic relay-crawling agent
// can hit any relay URL, ask "what do you carry," and find out this one
// speaks the marketplace's event kinds without ever having heard of this
// project specifically.
//
// The `oracle_marketplace` field is a custom NIP-11 extension (NIP-11
// permits arbitrary additional fields). It exists for "reflexive
// propagation" (see docs/nips/NIP-XX-agent-marketplace.md): once an agent
// finds ANY relay carrying this, it should be able to find every other
// entry point (other relays, the registry backend, how to publish) from
// this one document, with no separate directory lookup.

export interface RelayInfoOptions {
  name: string;
  description: string;
  /** Hex pubkey of the relay operator, if they want to be identifiable. Optional — operating a relay requires no identity (spec §4.2). */
  pubkey?: string;
  contact?: string;
  /** NIP numbers this relay implements, beyond the base protocol (kind 1 is base NIP-01). */
  supportedNips?: number[];
  software?: string;
  version?: string;
  /** Other relays known to carry the same marketplace event kinds — the propagation mechanism. */
  knownRelays?: string[];
  /** A handful of Arweave registry tx ids a newly-arriving agent can use to bootstrap its own discovery index immediately, per docs/DISCOVERY.md. */
  sampleListingTxIds?: string[];
}

export interface RelayInfoDocument {
  name: string;
  description: string;
  pubkey?: string;
  contact?: string;
  supported_nips: number[];
  software?: string;
  version?: string;
  oracle_marketplace: {
    event_kinds: { coordination: number; review: number };
    registry_backend: string;
    known_relays: string[];
    sample_listing_tx_ids: string[];
    docs: {
      nip: string;
      protocol: string;
      registry: string;
      discovery: string;
      trust: string;
      verification: string;
    };
  };
}

const DOC_PATHS = {
  nip: "docs/nips/NIP-XX-agent-marketplace.md",
  protocol: "docs/PROTOCOL.md",
  registry: "docs/REGISTRY.md",
  discovery: "docs/DISCOVERY.md",
  trust: "docs/TRUST.md",
  verification: "docs/VERIFICATION.md",
};

export function buildRelayInfo(opts: RelayInfoOptions): RelayInfoDocument {
  return {
    name: opts.name,
    description: opts.description,
    pubkey: opts.pubkey,
    contact: opts.contact,
    supported_nips: opts.supportedNips ?? [1],
    software: opts.software,
    version: opts.version,
    oracle_marketplace: {
      event_kinds: { coordination: 4200, review: 4201 },
      registry_backend: "arweave",
      known_relays: opts.knownRelays ?? [],
      sample_listing_tx_ids: opts.sampleListingTxIds ?? [],
      docs: DOC_PATHS,
    },
  };
}
