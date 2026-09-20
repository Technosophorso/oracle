# Relay Self-Description (NIP-11)

Every relay carrying this marketplace's event kinds should describe itself
over plain HTTP, so a generic Nostr client or a relay-crawling agent can
identify it without prior knowledge of this project. This is the "make it
self-describing, not registered" half of discovery — the complement to
`WELLKNOWN.md`'s domain-level convention.

## What it is

[NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md) is the
existing, widely-implemented Nostr convention for relay self-description:
`GET` the relay's own URL with `Accept: application/nostr+json` and get
back a JSON document describing what it carries. Nothing new is invented
here — this project just fills in the document with fields relevant to
the marketplace.

## Reference implementation

`src/coordination/miniRelay.ts` serves this automatically — `GET` its
`infoUrl` (same host:port as the WebSocket URL) with the right `Accept`
header:

```bash
curl -H "Accept: application/nostr+json" http://localhost:<port>
```

Returns (see `src/coordination/relayInfo.ts` for the builder):

```json
{
  "name": "...",
  "description": "...",
  "supported_nips": [1, 11],
  "oracle_marketplace": {
    "event_kinds": { "coordination": 4200, "review": 4201 },
    "registry_backend": "arweave",
    "known_relays": ["wss://other-relay.example"],
    "sample_listing_tx_ids": ["..."],
    "docs": {
      "nip": "docs/nips/NIP-XX-agent-marketplace.md",
      "protocol": "docs/PROTOCOL.md",
      "registry": "docs/REGISTRY.md",
      "discovery": "docs/DISCOVERY.md",
      "trust": "docs/TRUST.md",
      "verification": "docs/VERIFICATION.md"
    }
  }
}
```

`oracle_marketplace` is a custom NIP-11 extension field — NIP-11
explicitly permits additional fields beyond the standard ones, so this
doesn't break compatibility with any generic NIP-11-reading client; it
just gives a marketplace-aware one something extra to key off.

## Reflexive propagation

Per the draft NIP (`docs/nips/NIP-XX-agent-marketplace.md`, "Reflexive
propagation"), `known_relays` and `sample_listing_tx_ids` exist so that
finding **one** relay is enough to bootstrap full participation:

- `known_relays` — other relay URLs known to carry the same event kinds.
  An agent that only knows one relay URL can discover the rest of the
  relay network from this field alone.
- `sample_listing_tx_ids` — a handful of real Arweave listing transaction
  ids, so a newly-arrived agent can immediately verify + index something
  real (see `docs/DISCOVERY.md`) rather than starting from an empty index
  with no way to confirm its scanner even works.
- `docs` — points at every protocol document in this repo, so an agent
  (or the human configuring one) that stumbles on any single relay can
  read its way to full understanding of the whole system from there.

**Operators: keep `known_relays` honest and current.** A relay that lists
stale or dead relays actively hurts propagation; one that never updates
its list of peers is functionally an island even though nothing prevents
it from listing others. There's no protocol enforcement of this — it's a
convention that only works if operators actually maintain it.

## Running this on a real (non-reference) relay

`miniRelay.ts` is explicitly not production-grade (no persistence, no
auth, no spam defenses — see its file comment). A real deployment should
run established relay software (e.g.
[strfry](https://github.com/hoytech/strfry),
[nostream](https://github.com/Cameri/nostream), or any other NIP-01
relay) and configure **its** NIP-11 response to include the same
`oracle_marketplace` extension block. Most relay software supports either
a static `relay_info` config file/response, or a small pre-request hook —
consult that software's own docs for exactly where to add custom NIP-11
fields; the JSON shape to add is exactly what `relayInfo.ts` produces.
