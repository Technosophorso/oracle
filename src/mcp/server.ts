#!/usr/bin/env node
// MCP server exposing the-oracle's agent marketplace as tools for any MCP
// client (Claude Code, other agent runtimes). This is intentionally a
// thin registration layer — every tool below delegates to the already-
// implemented, already-tested logic in src/identity, src/coordination,
// src/registry, src/discovery, src/trust, and src/verification. See each
// module's own file/README for the actual behavior and guarantees; this
// file's job is only to expose that behavior with well-typed, well-
// described tool schemas.
//
// Transport: stdio, per the MCP TypeScript SDK's guidance for local/
// subprocess integrations (this is meant to be launched by an MCP client
// as a child process, not run as a standalone network service).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { CONFIG, getOrCreateIdentity, getOrCreateWallet, gatewayToOptions } from "./config.js";
import { DEFAULT_RELAYS, getPool, closePool } from "../coordination/relay.js";
import { publishText, publishCoordination } from "../coordination/subchat.js";
import { parseCoordinationEvent, KIND_COORDINATION } from "../coordination/messages.js";
import { createListing, verifyListing, type ListingKind } from "../registry/listing.js";
import { createArweaveClient, publishListing, fetchListing } from "../registry/arweave.js";
import { loadIndex, saveIndex, createEmptyIndex } from "../discovery/store.js";
import { scanAndIndex } from "../discovery/scan.js";
import { search as searchIndex } from "../discovery/search.js";
import { publishReview, fetchReviews } from "../trust/reviews.js";
import { fetchContinuity, continuityScore } from "../trust/continuity.js";
import { computeReputation } from "../trust/score.js";
import { verifyHttpListing } from "../verification/httpVerifier.js";
import type { ContinuityInfo } from "../trust/continuity.js";

const CHARACTER_LIMIT = 25_000;

function textResult(value: unknown): CallToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const truncated = text.length > CHARACTER_LIMIT;
  const body = truncated
    ? `${text.slice(0, CHARACTER_LIMIT)}\n\n[truncated: response exceeded ${CHARACTER_LIMIT} characters]`
    : text;
  return { content: [{ type: "text", text: body }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

const server = new McpServer({ name: "the-oracle-mcp-server", version: "0.1.0" });

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

server.registerTool(
  "oracle_identity_info",
  {
    title: "Show configured agent identity",
    description: `Show this MCP server's configured agent identity — the secp256k1 keypair used to sign coordination messages and registry listings (same key across both, per the marketplace's identity model).

If no identity has been configured yet, one is generated and persisted automatically on first call — no setup is required to start using read-only tools. Write tools (publishing listings, sending messages, publishing reviews) use this same identity.

Returns: { npub, publicKeyHex, identityFile, walletFile, relays, gateway } — no secret key material is ever returned.`,
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const identity = getOrCreateIdentity();
    return textResult({
      npub: identity.npub,
      publicKeyHex: identity.publicKeyHex,
      identityFile: CONFIG.identityFile,
      walletFile: CONFIG.walletFile,
      relays: CONFIG.relays,
      gateway: CONFIG.gateway,
    });
  },
);

// ---------------------------------------------------------------------------
// Registry (Arweave listings)
// ---------------------------------------------------------------------------

const ListingKindSchema = z.enum(["tool", "agent"]);

server.registerTool(
  "oracle_registry_search",
  {
    title: "Search the local listing index",
    description: `Keyword-search the local discovery index of tool/agent listings (see docs/DISCOVERY.md). This searches ONLY the local index file — it does not hit the network. If the index is empty or missing, this returns zero results with a hint to call oracle_registry_build_index first.

Args:
  - query (string): keywords to match against listing name/description/capabilities. Empty string matches everything (subject to filters).
  - kind ("tool" | "agent", optional): filter by listing kind.
  - capability (string, optional): filter to listings declaring this exact capability tag.
  - limit (number, optional, default 20, max 100): max results.

Returns: JSON array of { txId, kind, name, description, capabilities, publisher, blockHeight }.`,
    inputSchema: {
      query: z.string().describe("Keywords to search for; empty string matches everything"),
      kind: ListingKindSchema.optional(),
      capability: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ query, kind, capability, limit }) => {
    const index = loadIndex(CONFIG.indexFile, CONFIG.gateway);
    if (index.records.length === 0) {
      return textResult({
        results: [],
        hint: "Local index is empty. Call oracle_registry_build_index first to scan the registry.",
      });
    }
    const results = searchIndex(index, query, { kind, capability, limit }).map((r) => ({
      txId: r.txId,
      kind: r.listing.kind,
      name: r.listing.name,
      description: r.listing.description,
      capabilities: r.listing.capabilities,
      publisher: r.listing.publisher,
      blockHeight: r.blockHeight,
    }));
    return textResult(results);
  },
);

server.registerTool(
  "oracle_registry_build_index",
  {
    title: "Scan the registry and update the local index",
    description: `Scan the Arweave registry (see docs/DISCOVERY.md) and update the local discovery index used by oracle_registry_search. Resumes from the last scan by default; pass rebuild=true to rescan from the beginning (proves the index is independently reproducible, per the marketplace's design — no operator's index is authoritative).

This can take a while on a real gateway with many listings. Each scanned listing is signature-verified before being added — forged/malformed listings are silently skipped, never a failure.

Args:
  - gateway (string, optional): Arweave gateway URL. Defaults to the configured gateway (mainnet unless ORACLE_GATEWAY is set).
  - rebuild (boolean, optional, default false): ignore the saved cursor and rescan from the beginning.

Returns: { added, totalRecords, gateway } — added is how many NEW valid listings this run found.`,
    inputSchema: {
      gateway: z.string().url().optional(),
      rebuild: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ gateway, rebuild }) => {
    const effectiveGateway = gateway ?? CONFIG.gateway;
    const client = createArweaveClient(gatewayToOptions(effectiveGateway));
    const existing = rebuild ? createEmptyIndex(effectiveGateway) : loadIndex(CONFIG.indexFile, effectiveGateway);
    const before = existing.records.length;
    try {
      const updated = await scanAndIndex(client, effectiveGateway, existing);
      saveIndex(CONFIG.indexFile, updated);
      return textResult({
        added: updated.records.length - before,
        totalRecords: updated.records.length,
        gateway: effectiveGateway,
      });
    } catch (err) {
      return errorResult(
        `Failed to scan ${effectiveGateway}: ${err instanceof Error ? err.message : String(err)}. ` +
          `Check the gateway URL is reachable and supports the standard Arweave GraphQL endpoint.`,
      );
    }
  },
);

server.registerTool(
  "oracle_registry_fetch_listing",
  {
    title: "Fetch and verify a listing by transaction id",
    description: `Fetch a listing directly from Arweave by its transaction id and verify its signature. Does not require the local index — this goes straight to the gateway.

Args:
  - txId (string): the Arweave transaction id of the listing.
  - gateway (string, optional): defaults to the configured gateway.

Returns: { listing, signatureValid }. signatureValid=false means the content was tampered with or the listing is malformed — do not trust its claims if so.

Error Handling: returns an error if the transaction doesn't exist or its data isn't valid JSON.`,
    inputSchema: {
      txId: z.string().min(1),
      gateway: z.string().url().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ txId, gateway }) => {
    const client = createArweaveClient(gatewayToOptions(gateway ?? CONFIG.gateway));
    try {
      const listing = await fetchListing(client, txId);
      return textResult({ listing, signatureValid: verifyListing(listing) });
    } catch (err) {
      return errorResult(
        `Could not fetch/parse listing ${txId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);

server.registerTool(
  "oracle_registry_publish_listing",
  {
    title: "Publish a new tool/agent listing",
    description: `Sign and publish a new listing to the Arweave registry (docs/REGISTRY.md).

⚠️ PERMANENT AND PUBLIC: once published, a listing can never be edited or deleted by anyone, including you or this server's operator (that's the marketplace's core design — see the platform spec's "undeletable and ownerless" principle). Double-check all fields before calling this.

Uses this server's configured identity to sign the listing, and its configured Arweave wallet to pay for the transaction. The wallet is auto-created but NOT auto-funded — if it has no balance, this will fail with the wallet's address so you can fund it (or point ORACLE_WALLET_FILE at an already-funded wallet).

Args:
  - kind ("tool" | "agent"): what's being listed.
  - name (string): short name.
  - description (string): what it does.
  - capabilities (string[]): keywords for discovery.
  - interfaceTransport (string): how to invoke it, e.g. "http", "mcp", "nostr-dm", "cli". See docs/REGISTRY.md §3.
  - interfaceSpec (object): transport-specific invocation details, e.g. { "method": "POST", "url": "...", "responseSchema": {...} } for transport "http".
  - gateway (string, optional): defaults to the configured gateway.

Returns: { txId, listing } on success.

Error Handling: returns an actionable error (including the wallet address to fund) if the wallet has insufficient balance.`,
    inputSchema: {
      kind: ListingKindSchema,
      name: z.string().min(1).max(200),
      description: z.string().min(1).max(2000),
      capabilities: z.array(z.string()).min(1),
      interfaceTransport: z.string().min(1),
      interfaceSpec: z.unknown(),
      gateway: z.string().url().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ kind, name, description, capabilities, interfaceTransport, interfaceSpec, gateway }) => {
    const identity = getOrCreateIdentity();
    const wallet = await getOrCreateWallet();
    const effectiveGateway = gateway ?? CONFIG.gateway;
    const client = createArweaveClient(gatewayToOptions(effectiveGateway));

    const listing = createListing(identity, {
      kind: kind as ListingKind,
      name,
      description,
      capabilities,
      interface: { transport: interfaceTransport, spec: interfaceSpec },
      createdAt: new Date().toISOString(),
    });

    try {
      const address = await client.wallets.jwkToAddress(wallet);
      const balance = await client.wallets.getBalance(address);
      if (balance === "0") {
        return errorResult(
          `Wallet ${address} has zero balance on ${effectiveGateway}. Fund this address with AR ` +
            `(or set ORACLE_WALLET_FILE to an already-funded wallet) before publishing. ` +
            `No transaction was created.`,
        );
      }
      const result = await publishListing(client, wallet, listing);
      return textResult({ txId: result.id, listing });
    } catch (err) {
      return errorResult(`Failed to publish listing: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ---------------------------------------------------------------------------
// Coordination (Nostr subchats)
// ---------------------------------------------------------------------------

server.registerTool(
  "oracle_coordination_send_text",
  {
    title: "Send a plain-text chat message to a subchat",
    description: `Publish a plain-text message to a subchat topic (a Nostr kind:1 note tagged with the topic — see docs/PROTOCOL.md §3.1). Anyone subscribed to the same topic on the same relays will see it. Subchats need no creation step — publishing to a new topic string simply starts one.

Args:
  - topic (string): the subchat topic/tag. Use a collision-resistant name (e.g. a UUID) unless you want a public, guessable channel.
  - content (string): the message text.
  - relays (string[], optional): defaults to the configured relay list.

Returns: { eventId, topic, relays }.`,
    inputSchema: {
      topic: z.string().min(1),
      content: z.string().min(1),
      relays: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ topic, content, relays }) => {
    const identity = getOrCreateIdentity();
    const effectiveRelays = relays ?? CONFIG.relays;
    try {
      const event = await publishText(identity, topic, content, effectiveRelays);
      return textResult({ eventId: event.id, topic, relays: effectiveRelays });
    } catch (err) {
      return errorResult(`Failed to publish: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

const CoordinationActSchema = z.discriminatedUnion("act", [
  z.object({ act: z.literal("task-announce"), task: z.string().min(1), deadline: z.string().optional() }),
  z.object({ act: z.literal("bid"), taskId: z.string().min(1), proposal: z.string().min(1) }),
  z.object({ act: z.literal("award"), taskId: z.string().min(1), winner: z.string().min(1) }),
  z.object({ act: z.literal("propose"), content: z.string().min(1) }),
  z.object({ act: z.literal("accept"), refId: z.string().min(1) }),
  z.object({ act: z.literal("reject"), refId: z.string().min(1), reason: z.string().optional() }),
  z.object({ act: z.literal("inform"), content: z.string().min(1) }),
]);

server.registerTool(
  "oracle_coordination_send_act",
  {
    title: "Send a structured coordination message (Contract-Net / speech-act)",
    description: `Publish a structured, machine-parseable coordination message to a subchat (kind 4200, see docs/PROTOCOL.md §3.2 and §4). Use this instead of oracle_coordination_send_text when you want other agents' tooling to parse your message programmatically rather than as free text.

Vocabulary (pass the matching fields for "act"):
  - task-announce { task, deadline? } — announce a task/capability request.
  - bid { taskId, proposal } — respond to a task-announce with an offer. taskId is the eventId of the task-announce.
  - award { taskId, winner } — resolve a task-announce, naming the winning bidder's pubkey.
  - propose { content } — generic proposal outside the task-announce/bid flow.
  - accept { refId } — accept a prior propose/bid.
  - reject { refId, reason? } — reject a prior propose/bid.
  - inform { content } — share information, no response expected.

Args:
  - topic (string): the subchat topic.
  - message (object): one of the act shapes above.
  - to (string[], optional): pubkey(s) to address this to (omit for broadcast to the whole subchat).
  - relays (string[], optional): defaults to the configured relay list.

Returns: { eventId, topic, act }.`,
    inputSchema: {
      topic: z.string().min(1),
      message: CoordinationActSchema,
      to: z.array(z.string()).optional(),
      relays: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ topic, message, to, relays }) => {
    const identity = getOrCreateIdentity();
    const effectiveRelays = relays ?? CONFIG.relays;
    try {
      const event = await publishCoordination(identity, topic, message, { to }, effectiveRelays);
      return textResult({ eventId: event.id, topic, act: message.act });
    } catch (err) {
      return errorResult(`Failed to publish: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.registerTool(
  "oracle_coordination_read_subchat",
  {
    title: "Read recent messages from a subchat",
    description: `Do a one-shot read of recent messages (plain text and structured coordination acts) in a subchat topic. This is a single query, not a live subscription — call it again to check for new messages.

Args:
  - topic (string): the subchat topic to read.
  - sinceMinutes (number, optional, default 60): only return messages newer than this many minutes ago.
  - limit (number, optional, default 50, max 200): max messages to return.
  - relays (string[], optional): defaults to the configured relay list.

Returns: JSON array of messages sorted oldest-first: { eventId, pubkey, createdAt, kind: "text" | "coordination", content (text) or act (parsed coordination payload) }.`,
    inputSchema: {
      topic: z.string().min(1),
      sinceMinutes: z.number().int().min(1).max(10_080).default(60),
      limit: z.number().int().min(1).max(200).default(50),
      relays: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ topic, sinceMinutes, limit, relays }) => {
    const effectiveRelays = relays ?? CONFIG.relays;
    const pool = getPool();
    try {
      const since = Math.floor(Date.now() / 1000) - sinceMinutes * 60;
      const events = await pool.querySync(effectiveRelays, {
        kinds: [1, KIND_COORDINATION],
        "#t": [topic],
        since,
        limit,
      });
      const messages = events
        .sort((a, b) => a.created_at - b.created_at)
        .map((event) => {
          const parsed = parseCoordinationEvent(event);
          return parsed
            ? { eventId: event.id, pubkey: event.pubkey, createdAt: event.created_at, kind: "coordination" as const, act: parsed.payload }
            : { eventId: event.id, pubkey: event.pubkey, createdAt: event.created_at, kind: "text" as const, content: event.content };
        });
      return textResult(messages);
    } catch (err) {
      return errorResult(`Failed to read subchat: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ---------------------------------------------------------------------------
// Trust (reviews + reputation)
// ---------------------------------------------------------------------------

server.registerTool(
  "oracle_trust_publish_review",
  {
    title: "Publish a review of a listing",
    description: `Publish an ephemeral, signed review of a listing (docs/TRUST.md §1). Reviews are Nostr events referencing the listing's Arweave transaction id — never written permanently, and no relay is obligated to retain them.

Args:
  - listingTxId (string): the Arweave transaction id of the listing being reviewed.
  - rating (-1 | 0 | 1): -1 bad, 0 neutral/mixed, 1 good. Deliberately coarse.
  - comment (string, optional): free text.
  - relays (string[], optional): defaults to the configured relay list.

Returns: { eventId, listingTxId, rating }.`,
    inputSchema: {
      listingTxId: z.string().min(1),
      rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
      comment: z.string().optional(),
      relays: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ listingTxId, rating, comment, relays }) => {
    const identity = getOrCreateIdentity();
    const effectiveRelays = relays ?? CONFIG.relays;
    try {
      const event = await publishReview(identity, listingTxId, { rating, comment }, effectiveRelays);
      return textResult({ eventId: event.id, listingTxId, rating });
    } catch (err) {
      return errorResult(`Failed to publish review: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.registerTool(
  "oracle_trust_get_score",
  {
    title: "Compute a recency/continuity-weighted reputation score for a listing",
    description: `Fetch all reviews for a listing and compute a client-side reputation score (docs/TRUST.md §3): weighted by review recency (short half-life decay) and each reviewer's observed identity continuity (fresh/no-history reviewers count far less — this raises the cost of a Sybil attack, it does NOT prevent one; see docs/TRUST.md's explicit limitations).

This is NOT an official or authoritative score — it's one reference heuristic among many possible ones, computed fresh from public data every time you call this.

Args:
  - listingTxId (string): the Arweave transaction id of the listing.
  - halfLifeDays (number, optional, default 14): how fast old reviews decay.
  - relays (string[], optional): defaults to the configured relay list.

Returns: { score (-1..1), totalWeight, reviewCount }. A low totalWeight means "not enough reliable signal," not "bad" — check it before trusting the score.`,
    inputSchema: {
      listingTxId: z.string().min(1),
      halfLifeDays: z.number().positive().optional(),
      relays: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ listingTxId, halfLifeDays, relays }) => {
    const effectiveRelays = relays ?? CONFIG.relays;
    try {
      const reviews = await fetchReviews(listingTxId, effectiveRelays);
      const reviewerContinuity = new Map<string, ContinuityInfo>();
      for (const reviewer of new Set(reviews.map((r) => r.reviewer))) {
        reviewerContinuity.set(reviewer, await fetchContinuity(reviewer, { relays: effectiveRelays }));
      }
      const result = computeReputation(reviews, reviewerContinuity, { halfLifeDays });
      return textResult({
        ...result,
        reviewerContinuity: [...reviewerContinuity.entries()].map(([pubkey, info]) => ({
          pubkey,
          continuityScore: continuityScore(info),
          eventCount: info.eventCount,
        })),
      });
    } catch (err) {
      return errorResult(`Failed to compute score: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

server.registerTool(
  "oracle_verification_check_tool",
  {
    title: "Automatically verify an HTTP tool listing's claims",
    description: `Fetch a listing and, if it declares interfaceTransport "http", actually call it and validate the response against its declared JSON Schema (docs/VERIFICATION.md). This is "verify, don't trust" applied to the one part of a listing that's objectively checkable.

⚠️ SECURITY: this calls a URL supplied by an untrusted, permissionless listing. Default behavior refuses private/loopback network addresses (SSRF protection) — leave allowPrivateNetwork false unless you are deliberately testing a tool on your own private network. NEVER set it true for a listing you didn't author yourself.

Other transports ("mcp", "nostr-dm", "cli", ...) are reported as unsupported — this reference verifier only automates single stateless HTTP calls.

Args:
  - txId (string): the listing's Arweave transaction id.
  - gateway (string, optional): defaults to the configured gateway.
  - timeoutMs (number, optional, default 5000).
  - allowPrivateNetwork (boolean, optional, default false): see security note above.

Returns: { listing, verification: { supported, reachable?, statusCode?, schemaValid?, schemaErrors?, error? } }.`,
    inputSchema: {
      txId: z.string().min(1),
      gateway: z.string().url().optional(),
      timeoutMs: z.number().int().positive().optional(),
      allowPrivateNetwork: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ txId, gateway, timeoutMs, allowPrivateNetwork }) => {
    const client = createArweaveClient(gatewayToOptions(gateway ?? CONFIG.gateway));
    try {
      const listing = await fetchListing(client, txId);
      const verification = await verifyHttpListing(listing, { timeoutMs, allowPrivateNetwork });
      return textResult({ listing, verification });
    } catch (err) {
      return errorResult(`Failed to fetch/verify listing ${txId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`the-oracle MCP server running (identity: ${CONFIG.identityFile}, gateway: ${CONFIG.gateway})`);
}

process.on("SIGINT", () => {
  closePool(DEFAULT_RELAYS);
  process.exit(0);
});

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
