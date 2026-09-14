// Rebuildable scan of the Arweave listing log (spec §4.4).
//
// This is the piece that makes the index disposable rather than
// authoritative: it does not trust any prior index state except as a
// resume-point optimization (`cursor`). Pointed at a gateway with `cursor:
// null`, it reconstructs the full set of valid listings from nothing but
// the public chain — which is exactly what lets a second, independent
// operator verify (or replace) a first operator's index instead of having
// to trust it.
//
// "Valid" here means only "correctly signed by the pubkey it claims" —
// verifyListing, not any judgment about quality or trustworthiness of that
// pubkey (spec §4.5). A malformed or forged listing is dropped silently,
// the same way a relay drops an invalid Nostr event.

import type Arweave from "arweave";
import { verifyListing, type SignedListing } from "../registry/listing.js";
import { APP_NAME } from "../registry/arweave.js";
import type { IndexFile, IndexRecord } from "./store.js";

const PAGE_SIZE = 100;

interface GraphQLEdge {
  cursor: string;
  node: {
    id: string;
    block: { height: number; timestamp: number } | null;
  };
}

interface GraphQLResponse {
  data: {
    transactions: {
      pageInfo: { hasNextPage: boolean };
      edges: GraphQLEdge[];
    };
  };
}

async function fetchPage(gatewayUrl: string, after: string | null): Promise<GraphQLResponse["data"]["transactions"]> {
  const gql = `
    query($after: String) {
      transactions(
        tags: [{ name: "App-Name", values: ["${APP_NAME}"] }]
        sort: HEIGHT_ASC
        first: ${PAGE_SIZE}
        after: $after
      ) {
        pageInfo { hasNextPage }
        edges { cursor node { id block { height timestamp } } }
      }
    }
  `;
  const res = await fetch(`${gatewayUrl}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql, variables: { after } }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL scan request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as GraphQLResponse;
  return json.data.transactions;
}

export interface ScanOptions {
  onProgress?: (info: { processed: number; added: number; rejected: number }) => void;
}

/**
 * Scan a gateway's view of the chain for `oracle-registry` listings from
 * `existing.cursor` (or the beginning, if null) up to the current head,
 * verify each one, and return a new index with valid listings merged in.
 * Does not mutate `existing`.
 */
export async function scanAndIndex(
  client: Arweave,
  gatewayUrl: string,
  existing: IndexFile,
  opts: ScanOptions = {},
): Promise<IndexFile> {
  const seen = new Set(existing.records.map((r) => r.txId));
  const records = [...existing.records];
  let cursor = existing.cursor;
  let processed = 0;
  let added = 0;
  let rejected = 0;

  for (;;) {
    const page = await fetchPage(gatewayUrl, cursor);
    for (const edge of page.edges) {
      processed++;
      cursor = edge.cursor;
      const txId = edge.node.id;
      if (seen.has(txId)) continue;
      seen.add(txId);

      let listing: SignedListing;
      try {
        const raw = await client.transactions.getData(txId, { decode: true, string: true });
        listing = JSON.parse(raw as string) as SignedListing;
      } catch {
        rejected++;
        continue;
      }

      if (!verifyListing(listing)) {
        rejected++;
        continue;
      }

      const record: IndexRecord = {
        txId,
        blockHeight: edge.node.block?.height ?? null,
        blockTimestamp: edge.node.block?.timestamp ?? null,
        listing,
        indexedAt: new Date().toISOString(),
      };
      records.push(record);
      added++;
    }
    opts.onProgress?.({ processed, added, rejected });
    if (!page.pageInfo.hasNextPage) break;
  }

  return { ...existing, gatewayUrl, cursor, records };
}
