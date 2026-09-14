# Trust tooling (Phase 5, optional, client-side)

Reference client-side trust heuristics over public Nostr/registry history, per spec §4.5.

- [`reviews.ts`](./reviews.ts) — ephemeral Nostr review events referencing a listing's Arweave tx id.
- [`continuity.ts`](./continuity.ts) — estimates an identity's observed history/continuity from relays.
- [`score.ts`](./score.ts) — recency- and reviewer-continuity-weighted reputation scoring.
- [`cli.ts`](./cli.ts) — `review` (publish) and `score` (aggregate) commands.

Full rationale, the exact reference formulas, and their known limits (this does not solve Sybil resistance — spec §8): [`docs/TRUST.md`](../../docs/TRUST.md).

Try it: `npm run demo:trust` shows an established reviewer's vote outweighing a freshly-minted Sybil's opposite vote, against a local in-memory relay ([`../coordination/miniRelay.ts`](../coordination/miniRelay.ts)) so timestamps are controllable and the run is deterministic.

None of this is required to use the coordination or registry layers — it's optional tooling an agent can adopt, fork, or ignore (spec §4.5).
