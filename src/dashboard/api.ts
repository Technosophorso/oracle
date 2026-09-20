// Business logic for the local dashboard's HTTP API. Deliberately thin —
// every handler here delegates to the same already-tested modules the
// MCP server (../mcp/server.ts) uses, and shares the same identity/wallet/
// index files via ../mcp/config.js's CONFIG. Running the dashboard and the
// MCP server side by side operates on the same local state, on purpose.

import { CONFIG, getOrCreateIdentity, getOrCreateWallet, gatewayToOptions } from "../mcp/config.js";
import { getPool } from "../coordination/relay.js";
import { publishText, publishCoordination } from "../coordination/subchat.js";
import { parseCoordinationEvent, KIND_COORDINATION, type CoordinationAct } from "../coordination/messages.js";
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

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function getIdentityInfo() {
  const identity = getOrCreateIdentity();
  return {
    npub: identity.npub,
    publicKeyHex: identity.publicKeyHex,
    identityFile: CONFIG.identityFile,
    walletFile: CONFIG.walletFile,
    indexFile: CONFIG.indexFile,
    relays: CONFIG.relays,
    gateway: CONFIG.gateway,
  };
}

/**
 * Recent coordination activity with no topic filter, used to populate a
 * topic picker in the UI. On a public relay this is a firehose of
 * whatever else that relay carries — appropriate default is a
 * private/community relay or the reference MiniRelay, not relay.damus.io.
 */
export async function listRecentTopics(sinceMinutes: number, limit: number) {
  const pool = getPool();
  const since = Math.floor(Date.now() / 1000) - sinceMinutes * 60;
  const events = await pool.querySync(CONFIG.relays, { kinds: [1, KIND_COORDINATION], since, limit });
  const topics = new Map<string, { count: number; lastSeen: number }>();
  for (const event of events) {
    const topic = event.tags.find((t) => t[0] === "t")?.[1];
    if (!topic) continue;
    const existing = topics.get(topic);
    if (!existing || existing.lastSeen < event.created_at) {
      topics.set(topic, { count: (existing?.count ?? 0) + 1, lastSeen: event.created_at });
    } else {
      existing.count++;
    }
  }
  return [...topics.entries()]
    .map(([topic, info]) => ({ topic, ...info }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

export async function readSubchat(topic: string, sinceMinutes: number, limit: number) {
  const pool = getPool();
  const since = Math.floor(Date.now() / 1000) - sinceMinutes * 60;
  const events = await pool.querySync(CONFIG.relays, { kinds: [1, KIND_COORDINATION], "#t": [topic], since, limit });
  return events
    .sort((a, b) => a.created_at - b.created_at)
    .map((event) => {
      const parsed = parseCoordinationEvent(event);
      return parsed
        ? { eventId: event.id, pubkey: event.pubkey, createdAt: event.created_at, kind: "coordination" as const, act: parsed.payload }
        : { eventId: event.id, pubkey: event.pubkey, createdAt: event.created_at, kind: "text" as const, content: event.content };
    });
}

export async function sendText(topic: string, content: string) {
  const identity = getOrCreateIdentity();
  const event = await publishText(identity, topic, content, CONFIG.relays);
  return { eventId: event.id };
}

export async function sendAct(topic: string, message: CoordinationAct, to?: string[]) {
  const identity = getOrCreateIdentity();
  const event = await publishCoordination(identity, topic, message, { to }, CONFIG.relays);
  return { eventId: event.id };
}

export function registrySearch(query: string, kind: ListingKind | undefined, capability: string | undefined, limit: number) {
  const index = loadIndex(CONFIG.indexFile, CONFIG.gateway);
  const results = searchIndex(index, query, { kind, capability, limit });
  return {
    totalIndexed: index.records.length,
    results: results.map((r) => ({
      txId: r.txId,
      kind: r.listing.kind,
      name: r.listing.name,
      description: r.listing.description,
      capabilities: r.listing.capabilities,
      publisher: r.listing.publisher,
      blockHeight: r.blockHeight,
    })),
  };
}

export async function buildIndex(gateway: string | undefined, rebuild: boolean) {
  const effectiveGateway = gateway ?? CONFIG.gateway;
  const client = createArweaveClient(gatewayToOptions(effectiveGateway));
  const existing = rebuild ? createEmptyIndex(effectiveGateway) : loadIndex(CONFIG.indexFile, effectiveGateway);
  const before = existing.records.length;
  const updated = await scanAndIndex(client, effectiveGateway, existing);
  saveIndex(CONFIG.indexFile, updated);
  return { added: updated.records.length - before, totalRecords: updated.records.length, gateway: effectiveGateway };
}

export async function getListing(txId: string, gateway: string | undefined) {
  const client = createArweaveClient(gatewayToOptions(gateway ?? CONFIG.gateway));
  const listing = await fetchListing(client, txId);
  return { listing, signatureValid: verifyListing(listing) };
}

export interface PublishListingInput {
  kind: ListingKind;
  name: string;
  description: string;
  capabilities: string[];
  interfaceTransport: string;
  interfaceSpec: unknown;
  gateway?: string;
}

export async function publishNewListing(input: PublishListingInput) {
  const identity = getOrCreateIdentity();
  const wallet = await getOrCreateWallet();
  const effectiveGateway = input.gateway ?? CONFIG.gateway;
  const client = createArweaveClient(gatewayToOptions(effectiveGateway));

  const listing = createListing(identity, {
    kind: input.kind,
    name: input.name,
    description: input.description,
    capabilities: input.capabilities,
    interface: { transport: input.interfaceTransport, spec: input.interfaceSpec },
    createdAt: new Date().toISOString(),
  });

  const address = await client.wallets.jwkToAddress(wallet);
  const balance = await client.wallets.getBalance(address);
  if (balance === "0") {
    throw new ApiError(
      `Wallet ${address} has zero balance on ${effectiveGateway}. Fund this address before publishing.`,
      409,
    );
  }
  const result = await publishListing(client, wallet, listing);
  return { txId: result.id, listing };
}

export async function getTrustScore(listingTxId: string, halfLifeDays: number | undefined) {
  const reviews = await fetchReviews(listingTxId, CONFIG.relays);
  const reviewerContinuity = new Map<string, ContinuityInfo>();
  for (const reviewer of new Set(reviews.map((r) => r.reviewer))) {
    reviewerContinuity.set(reviewer, await fetchContinuity(reviewer, { relays: CONFIG.relays }));
  }
  const result = computeReputation(reviews, reviewerContinuity, { halfLifeDays });
  return {
    ...result,
    reviews: reviews.map((r) => ({
      reviewer: r.reviewer,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      reviewerContinuityScore: continuityScore(reviewerContinuity.get(r.reviewer)!),
    })),
  };
}

export async function submitReview(listingTxId: string, rating: -1 | 0 | 1, comment: string | undefined) {
  const identity = getOrCreateIdentity();
  const event = await publishReview(identity, listingTxId, { rating, comment }, CONFIG.relays);
  return { eventId: event.id };
}

export async function checkTool(
  txId: string,
  gateway: string | undefined,
  timeoutMs: number | undefined,
  allowPrivateNetwork: boolean,
) {
  const client = createArweaveClient(gatewayToOptions(gateway ?? CONFIG.gateway));
  const listing = await fetchListing(client, txId);
  const verification = await verifyHttpListing(listing, { timeoutMs, allowPrivateNetwork });
  return { listing, verification };
}
