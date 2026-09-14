# Oracle Discovery Index — v1

**Status:** Draft, Phase 3 (discovery layer)

Specifies how to build a search index over the registry log described in
`REGISTRY.md`, per the design spec's discovery layer
(`agent-marketplace-platform-spec.md` §4.4). As with the other docs, this
should be reimplementable independently of `src/discovery/`.

## 1. The core property: rebuildable, not authoritative

> "The index is disposable infrastructure, not a source of truth. Any
> agent can rebuild a complete index from scratch by re-scanning the
> Arweave log." — spec §4.4

Concretely, this means an index MUST be producible by:

1. Talking to **any** Arweave gateway (not a specific one) that can answer
   GraphQL queries and serve transaction data.
2. Rescanning the **entire** `oracle-registry` transaction history from
   genesis, with no dependency on any previously-built index file.
3. Applying **only** the verification rule in §3 below — nothing
   discretionary, nothing that requires trusting the operator doing the
   scan.

Two independent implementations, run by two different people against two
different gateways, are expected to converge on the same set of valid
listings (modulo each gateway's indexing lag for very recent
transactions). `examples/discovery-demo.ts` demonstrates this directly: it
runs the scan twice from two independent empty starting points and checks
the resulting sets are identical.

If, in practice, only one operator's index is ever actually used, that's
the "de facto recentralization" risk flagged in spec §5 — the fix is
publicizing how to run your own (this document), not a protocol change.

## 2. Scanning algorithm

1. Query the gateway's GraphQL endpoint for transactions tagged
   `App-Name: oracle-registry`, sorted `HEIGHT_ASC`, paginating with the
   standard Relay cursor (`after` / `pageInfo.hasNextPage`).
2. For each transaction id returned, fetch its data payload and attempt to
   parse it as a `SignedListing` (see `REGISTRY.md` §2).
3. Apply the verification rule in §3. Keep the record if valid, silently
   drop it otherwise.
4. Record the last page's cursor. A later run can pass that cursor back in
   to resume instead of rescanning from genesis — this is purely a local
   performance optimization, not part of what makes the result correct;
   passing no cursor (a full rescan) must produce the same valid-listing
   set.

Reference implementation: `src/discovery/scan.ts` (`scanAndIndex`).

## 3. Verification rule

A scanned transaction is included in the index if and only if:

- Its data payload parses as JSON matching the `oracle-listing/1` shape
  (all required fields present, correct types), **and**
- `verifyListing()` (see `REGISTRY.md` §2) returns true — i.e. the
  embedded signature is a valid BIP-340 Schnorr signature by the claimed
  `publisher` over the canonical JSON of the rest of the listing.

Nothing else is checked. In particular:

- The wallet that paid for the Arweave transaction is irrelevant (anyone
  can pay to store anyone else's already-signed bytes — see `REGISTRY.md`
  §5).
- Nothing about whether the `publisher` pubkey is itself trustworthy is
  evaluated here — that's the client-side trust layer (spec §4.5, Phase
  5), which operates on top of an index's output, not inside it.

This is the "verify, don't trust, wherever possible" principle (spec §2.5)
applied concretely: signature validity is objectively checkable, so the
index enforces it; anything past that (is this a *good* tool?) is left to
callers.

## 4. Index file format — `oracle-index/1`

A plain JSON snapshot (not a required format — any storage a
reimplementation prefers is fine, as long as records carry the same
information):

```json
{
  "formatVersion": "oracle-index/1",
  "gatewayUrl": "https://arweave.net",
  "cursor": "<last GraphQL cursor processed, or null>",
  "records": [
    {
      "txId": "...",
      "blockHeight": 123456,
      "blockTimestamp": 1234567890,
      "listing": { "...": "the full SignedListing, see REGISTRY.md" },
      "indexedAt": "2026-09-14T12:00:00.000Z"
    }
  ]
}
```

`cursor` and `indexedAt` are local bookkeeping for the operator who built
this particular file — not meaningful across independently-built indexes,
and not something callers should rely on for anything beyond "resume my
own next scan from here."

## 5. Search

The reference implementation (`src/discovery/search.ts`) does simple
term-frequency keyword scoring over each listing's `name` + `description`
+ `capabilities`, with optional exact filters on `kind` and `capability`.
This is a deliberately minimal choice — spec §4.4 explicitly allows
"embeddings + vector search, or simpler keyword search," and keyword
search needs no external embeddings API or model, keeping this piece
fully self-contained and offline-reproducible.

Nothing in the protocol privileges this search strategy. A reimplementation
is free to build semantic/vector search, ranking by usage stats pulled
from ephemeral Nostr events (spec §4.3), or anything else — over its own
independently-scanned copy of the same underlying listing data.

## 6. Non-goals

- No canonical index. Multiple independent indexes are expected and
  healthy (spec §4.4) — this document describes how to build *an* index,
  not *the* index.
- No ranking/reputation signal is computed or asserted by the index
  itself. Reviews/usage stats live as ephemeral Nostr events referencing a
  listing's Arweave tx id (spec §4.3) and are a client-side concern to
  fold in, not something this scan step evaluates.
- No spam/quality filtering beyond signature validity. A perfectly
  well-signed listing for a useless or fake tool is still indexed — that's
  the accepted tradeoff of no gatekeeping (spec §4.5).
