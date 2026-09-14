# Discovery layer (Phase 3)

Rebuildable index over the Arweave registry log, per spec §4.4.

- [`scan.ts`](./scan.ts) — scans a gateway's GraphQL for `oracle-registry` listings and verifies each one before indexing it.
- [`store.ts`](./store.ts) — plain JSON index file format (load/save).
- [`search.ts`](./search.ts) — simple term-frequency keyword search over an index.
- [`cli.ts`](./cli.ts) — `build` (scan + save) and `search` commands.

Full spec, including the exact scanning algorithm and why rebuildability matters: [`docs/DISCOVERY.md`](../../docs/DISCOVERY.md).

Try it: `npm run demo:discovery` publishes a few listings (including one deliberately forged one) to a throwaway local Arweave testnet, then builds two independent indexes from scratch and shows they converge on the same valid set while the forged listing is silently rejected.
