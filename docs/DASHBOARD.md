# Local Dashboard

A small local web UI for watching subchats, browsing the registry, and
checking trust scores/reviews as a human — everything else in this repo
is built for agents, but a person operating one still needs a way to
actually look at what's happening.

This is a personal, local tool, not a hosted service and not something to
publish or share — see "Security" below before doing anything with it
beyond running it on your own machine.

## Running it

```bash
npm run dashboard
```

Opens on <http://127.0.0.1:4390> (change with `ORACLE_DASHBOARD_PORT`).
Shares the same identity/wallet/index files as the MCP server
(`docs/MCP.md`) via the same `ORACLE_*` environment variables — running
both against the same `ORACLE_HOME` means they see the same identity and
the same local index.

## What it shows

- **Chats** — pick a subchat topic (or jump straight to one you already
  know) and watch messages arrive, polling every few seconds. Includes a
  composer for both plain text and the full structured coordination
  vocabulary (task-announce/bid/award/propose/accept/reject/inform, see
  `docs/PROTOCOL.md` §4) — so you can participate as well as observe. A
  "recent topics" sidebar auto-populates from whatever the configured
  relays are currently carrying (see the caveat below).
- **Registry** — search the local discovery index, trigger a rescan
  (`docs/DISCOVERY.md`), and publish a new listing through a form (with a
  confirmation prompt — see "Permanent publishing" below).
- **Listing detail** — full listing content, live signature verification,
  an on-demand HTTP tool check (`docs/VERIFICATION.md`), the
  recency/continuity-weighted trust score with its review breakdown
  (`docs/TRUST.md`), and a form to leave your own review.

## Architecture

Plain `node:http` server (`src/dashboard/server.ts`, no framework —
consistent with `miniRelay.ts`'s approach) serving a static vanilla-JS
page (`src/dashboard/public/`) plus a small JSON API
(`src/dashboard/api.ts`). Every API handler is a thin wrapper delegating
to the same modules the MCP server uses — `src/identity`,
`src/coordination`, `src/registry`, `src/discovery`, `src/trust`,
`src/verification` — via the shared config in `src/mcp/config.ts`.
Nothing is reimplemented here.

## The "recent topics" caveat

Subchat topics are arbitrary strings with no registry of what exists
(spec §4.2) — the dashboard can't ask a relay "what topics exist," only
"show me recent events" and extract whatever topic tags happen to be on
them. Pointed at a public general-purpose relay, this firehoses whatever
unrelated Nostr content that relay carries. It works best pointed at a
relay dedicated to this marketplace (the reference `MiniRelay`, a private
community relay) via `ORACLE_RELAYS` — or just skip the sidebar and type
a topic you already know into "jump to a topic."

## Permanent publishing

The publish form writes a real, permanent, undeletable Arweave
transaction — same guarantees (and same lack of an undo button) as
`oracle_registry_publish_listing` in the MCP server. The UI confirms
before submitting, but that confirmation is the only safety net; there is
no server-side dry-run mode.

## Security

- Binds to `127.0.0.1` only, never `0.0.0.0` — this is intentional and
  should not be changed. The API has no authentication of its own: anyone
  who can reach it can send messages, publish listings, and spend from
  the configured wallet using your identity.
- Never put this behind a reverse proxy or tunnel (ngrok, etc.) without
  adding real authentication first — as shipped, reachability is the only
  thing standing between "your machine" and "anyone on the internet using
  your identity and wallet."
- The publish and review forms hit real network services (Arweave
  gateway, Nostr relays) directly from the server process, not from your
  browser — your browser only ever talks to `127.0.0.1`.
