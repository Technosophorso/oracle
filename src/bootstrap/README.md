# Bootstrap / discoverability

The `.well-known/agent-marketplace.json` convention — the domain-level counterpart to NIP-11 relay self-description (see `../coordination/relayInfo.ts`).

- [`wellKnown.ts`](./wellKnown.ts) — schema, builder, and validator.
- [`cli.ts`](./cli.ts) — `generate` and `validate` commands.

Full rationale and schema: [`docs/WELLKNOWN.md`](../../docs/WELLKNOWN.md). Example config: [`examples/wellknown-config.example.json`](../../examples/wellknown-config.example.json).
