# MCP server

Exposes the whole marketplace (identity, coordination, registry, discovery, trust, verification) as MCP tools for any MCP client — the "connect to the marketplace is a one-line config change" piece.

- [`server.ts`](./server.ts) — tool registrations. A thin layer; every tool delegates to the already-tested logic in `../identity`, `../coordination`, `../registry`, `../discovery`, `../trust`, `../verification`.
- [`config.ts`](./config.ts) — environment-based configuration and lazy identity/wallet auto-provisioning.

Full tool list, config options, and a first-run walkthrough: [`docs/MCP.md`](../../docs/MCP.md).

Run directly: `npm run mcp` (stdio transport — expects an MCP client on the other end, not a human at a terminal).
