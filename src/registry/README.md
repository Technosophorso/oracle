# Registry layer (Phase 2)

Arweave-backed tool/agent listing publish + fetch logic, per spec §4.3.

- [`listing.ts`](./listing.ts) — listing schema, canonical JSON, sign/verify (same secp256k1 keypair as the coordination layer).
- [`arweave.ts`](./arweave.ts) — Arweave client wrapper: publish, fetch by tx id, tag-based GraphQL lookup.
- [`cli.ts`](./cli.ts) — command-line publish/fetch/query.

Full wire format: [`docs/REGISTRY.md`](../../docs/REGISTRY.md).

Try it: `npm run demo:registry` runs a full sign → publish → fetch → verify → query round trip against a throwaway local Arweave testnet (no funded wallet or real cost required).
