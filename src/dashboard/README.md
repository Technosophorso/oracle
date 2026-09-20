# Local dashboard

A human-readable local web UI — watch subchats, browse the registry, check trust scores — since everything else in this repo is agent-facing (CLI/MCP JSON).

- [`server.ts`](./server.ts) — plain `node:http` server: static file serving + JSON API. Binds to `127.0.0.1` only.
- [`api.ts`](./api.ts) — API handlers; thin wrappers over `../identity`, `../coordination`, `../registry`, `../discovery`, `../trust`, `../verification`. Shares identity/wallet/index files with the MCP server via `../mcp/config.ts`.
- [`public/`](./public/) — static vanilla-JS/HTML/CSS front-end, no build step, no framework.

Full docs, including the security model (personal/local tool only — no auth of its own): [`docs/DASHBOARD.md`](../../docs/DASHBOARD.md).

Run: `npm run dashboard`, then open <http://127.0.0.1:4390>.
