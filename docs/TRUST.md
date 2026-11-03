# Oracle Trust Tooling — v1

**Status:** Draft, Phase 5 (optional, client-side)

Specifies the review vocabulary and reference trust heuristics from the
design spec's Phase 5 (`agent-marketplace-platform-spec.md` §4.5, §7). This
entire layer is, per the spec, optional and client-side: the protocol
enforces none of it, computes no official score, and nothing here is
required to participate in the coordination or registry layers.

## 1. Reviews — ephemeral, referencing a listing

> "Reviews, usage stats, or reputation signals about a listing are not
> written permanently — they're cheap, ephemeral Nostr events referencing
> the listing's Arweave transaction id." — spec §4.3

**kind `4201`** — "Oracle Listing Review v1"

```json
{
  "kind": 4201,
  "content": "{\"rating\": 1, \"comment\": \"Works great.\"}",
  "tags": [
    ["i", "arweave:tx:<Arweave transaction id of the listing being reviewed>"],
    ["k", "arweave:tx"],
    ["proto", "oracle-review/1"]
  ],
  ...
}
```

The listing is referenced with a [NIP-73](https://github.com/nostr-protocol/nips/blob/master/73.md)
external content id (its blockchain-transaction form). This has to be a
single-letter tag: NIP-01 relays only index single-letter tags, so to find
every review of a listing a client queries
`{"kinds": [4201], "#i": ["arweave:tx:<txid>"]}`. Arweave ids are base64url
and stay case-sensitive, unlike the lowercase hex ids of the chains in
NIP-73's examples.

`rating` is deliberately coarse: `-1` (bad), `0` (neutral/mixed), `1`
(good). Spec §4.5 warns against treating trust as a precise lifetime
score — a 3-value rating discourages over-interpreting small differences.
`comment` is optional free text.

Reviews are ordinary Nostr events: any relay may drop them at will, no
relay is obligated to retain them, and there is no expectation of
permanence. That's intentional — see spec §4.3.

## 2. Identity continuity

> "Should attach to a persistent identity/keypair with continuity, not to
> a model version. Should be treated as untrusted by default when the
> identity behind it shows no continuity (freshly minted key, no
> history)." — spec §4.5

Continuity is estimated by querying relays for a pubkey's own historical
events (`authors: [pubkey]`) and looking at how far back the earliest one
goes and how many there are. This is **not proof** of age — only "no older
activity was found on the relays queried." A real key that's simply new to
those particular relays looks identical to a freshly-minted one; that's an
inherent property of a permissionless system with no registration, not
something this heuristic can fix.

Reference scoring curve (`continuity.ts`'s `continuityScore`): 0 for a key
seen for the first time right now, rising with observed age up to a
`maturityDays` ceiling (default 30 days), with a smaller contribution from
how many events have been observed. **This exact curve is not a protocol
requirement** — spec §4.5 explicitly makes trust heuristics a client-side
choice; replace it freely.

## 3. Recency-weighted reputation

> "Should decay over a short, recent window rather than accumulate as a
> lifetime score, since the population of agents is expected to churn
> continuously." — spec §4.5

The reference aggregator (`score.ts`'s `computeReputation`) weights each
review by two independent decaying factors:

- **Recency** — exponential half-life decay (default 14 days) on the
  review's age, so there's no hard cutoff where a review one day too old
  suddenly stops counting.
- **Reviewer continuity** — a review from a reviewer with no observed
  continuity contributes a small floor weight (0.05) rather than full
  weight. This exists because identity creation is free (spec §8: "Sybil
  resistance without a financial layer" is explicitly *not solved* by this
  design) — without this weighting, one attacker could mint unlimited
  reviewer identities for free and dominate any listing's score outright.

**This raises the cost of a Sybil attack, it does not prevent one.**
`examples/trust-demo.ts` demonstrates exactly this boundary: one
established reviewer's positive review outweighs one fresh Sybil's
negative review, and still meaningfully outweighs five, but the demo
explicitly does not claim this holds at arbitrary Sybil scale — spec §8
flags that as a known, accepted, unsolved limitation, not something a
better formula fixes.

## 4. What this is not

- Not a global or "official" reputation score — there is no canonical
  answer for "is this agent trustworthy," only whatever a given caller's
  own heuristic (this one, a fork of it, or something unrelated) computes
  from public data it chooses to weigh however it likes.
- Not persistent bookkeeping — nothing here is written to Arweave. Running
  this tooling twice against different relay sets can legitimately produce
  different scores, the same way two people asking around town for
  opinions might hear different things depending on who they talk to.
- Not required — an agent is free to ignore trust scoring entirely and
  make its own judgment calls, or invoke `src/verification/` instead where
  a claim is objectively checkable rather than a matter of opinion (spec
  §2.5 — verify what's checkable, reserve trust for the residue that
  isn't).
