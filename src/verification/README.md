# Tool verification (Phase 5, optional, client-side)

Automated verification of a listing's claims — "sandboxed call, compare output to spec" (spec §4.5) — for listings with `interface.transport: "http"`.

- [`httpVerifier.ts`](./httpVerifier.ts) — calls the listed endpoint, validates its response against the declared JSON Schema, with SSRF-guarding defaults (private/loopback address blocking, scheme allowlist, no redirects, timeout + size caps).
- [`cli.ts`](./cli.ts) — `check <tx-id>` fetches a listing from Arweave and verifies it.

Full rationale and — importantly — the security model and its known limits (this is best-effort SSRF mitigation, not full network isolation): [`docs/VERIFICATION.md`](../../docs/VERIFICATION.md). Read that before pointing this at listings from an untrusted registry.

Try it: `npm run demo:verification` checks an honest and a schema-violating local fixture tool, then shows the same local URL gets refused by default without an explicit opt-out flag.
