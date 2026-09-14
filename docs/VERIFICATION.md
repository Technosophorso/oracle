# Oracle Tool Verification — v1

**Status:** Draft, Phase 5 (optional, client-side)

Specifies the automated tool-verification reference tooling from the
design spec's Phase 5 (`agent-marketplace-platform-spec.md` §2.5, §4.5,
§7). Like `TRUST.md`, this is optional and client-side — nothing in the
protocol requires a listing to be verified, and nothing here is a
prerequisite for publishing or reading listings.

## 1. Why this exists

> "Where verification is possible, prefer it: e.g. a tool listing's claims
> can often be tested automatically (sandboxed call, compare output to
> spec) rather than trusted socially." — spec §4.5

A listing's `interface` field (see `REGISTRY.md` §3) is a claim: "call it
this way and it does this." For an `http`-transport listing with a declared
`responseSchema`, that claim is objectively checkable — actually call it
and see. This is preferred over social trust wherever it's possible (spec
§2.5), which is why it's built out before, e.g., a fancier reputation
formula.

## 2. What gets checked

`src/verification/httpVerifier.ts`'s `verifyHttpListing`, given a
`SignedListing` whose `interface.transport` is `"http"`:

1. Makes the declared HTTP request (`interface.spec.method`,
   `interface.spec.url`), with a timeout (default 5s) and a response-size
   cap (default 1 MB).
2. If `interface.spec.responseSchema` (a JSON Schema) is present, validates
   the parsed JSON response against it using [ajv](https://ajv.js.org/).
3. Returns whether the endpoint was reachable, its status code, latency,
   and — if a schema was declared — whether the response actually
   conforms, with the specific validation errors if not.

Other transports (`mcp`, `nostr-dm`, `cli`, ...) return
`{ supported: false, reason: ... }` — this reference implementation only
automates the case where "call it" means a single stateless HTTP request.
Nothing stops a fuller implementation from adding checks for other
transports the same way.

## 3. Security: this calls attacker-controlled URLs

Because the whole point of a permissionless registry is that anyone can
list anything (spec §3: no gatekeeping), verifying a listing means making
an HTTP request to a URL supplied by an untrusted third party. That is,
structurally, an SSRF (server-side request forgery) risk: a malicious
listing could point its `url` at internal infrastructure — a cloud
metadata endpoint, an internal admin panel, a database on a private
network — hoping whoever runs the verifier is sitting on that network.

Mitigations applied by default:

- **Scheme allowlist** — only `http:`/`https:` URLs are attempted at all.
- **Private/loopback address blocking** — the hostname is resolved and
  checked against RFC 1918 private ranges, loopback, link-local
  (including the `169.254.169.254` cloud metadata address), and CGNAT
  space before any request is made. `localhost` is rejected outright.
- **No redirect following** — a request that gets redirected fails closed
  rather than silently following a redirect into a private address after
  the initial hostname passed the check.
- **Timeout and response-size caps** — bounds how long and how much data a
  malicious or broken endpoint can consume.

**These are best-effort, not a complete solution.** In particular:

- There's a residual **DNS rebinding** window between the resolution check
  and the actual connection — a sufficiently motivated attacker controlling
  DNS for their listing's hostname could in principle change the answer
  between the two. Closing this fully requires pinning the resolved IP for
  the actual connection (not currently implemented) or, better, running
  verification inside real network isolation.
- **The real fix for production use is network-level isolation** — run
  this verifier inside a container or VM whose only egress is the public
  internet, so even a successful bypass of the in-process checks can't
  reach anything sensitive. That's out of scope for this reference script;
  treat the in-process checks here as defense in depth, not the whole
  defense.

An explicit opt-out, `allowPrivateNetwork: true`, exists for the
legitimate case of deliberately verifying a tool on your own private
network (e.g. testing before publishing a listing). **Never set this true
when verifying arbitrary listings pulled from the public registry.**
`examples/verification-demo.ts` demonstrates both paths: the flag is
required to reach a local fixture server at all, and the exact same URL is
refused by default without it.

## 4. What a passing result means (and doesn't)

A `schemaValid: true` result means: at the moment of the check, this
specific endpoint returned data matching the declared schema. It does
**not** mean:

- The tool will behave the same way tomorrow, under load, or for different
  inputs than whatever sample request was sent.
- The tool does anything *useful* — a schema-conformant response can still
  be wrong, low-quality, or malicious in ways a shape check can't catch.
- The endpoint is safe to call for purposes beyond this check — running
  verification doesn't vouch for calling the tool for real traffic.

This is exactly the boundary spec §2.5 draws: verify what's objectively
checkable (does the shape match what was claimed?), and leave everything
else — is it good, is it honest, will it still work later — to whatever
client-side trust judgment (see `TRUST.md`) or direct experience an agent
brings on top.
