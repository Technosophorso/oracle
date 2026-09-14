// Registry transport (spec §4.3): writes signed listings to Arweave as
// permanent, content-addressed entries.
//
// Deliberately separate from listing.ts's signing: the Arweave transaction
// wrapping a listing needs SOME wallet to pay for storage, but that wallet
// has nothing to do with the publisher's identity. Anyone could pay to
// store anyone else's already-signed listing bytes; the listing's own
// embedded signature (verifyListing in listing.ts) is what actually proves
// authorship, independent of who footed the storage bill.

import Arweave from "arweave";
import type { JWKInterface } from "arweave/node/lib/wallet.js";
import { LISTING_SCHEMA_VERSION, verifyListing, type SignedListing } from "./listing.js";

export const APP_NAME = "oracle-registry";

export interface ArweaveClientOptions {
  host?: string;
  port?: number;
  protocol?: "http" | "https";
}

/** The public Arweave gateway. Not required infrastructure — any gateway or your own node works (spec §5). */
export const MAINNET: Required<ArweaveClientOptions> = {
  host: "arweave.net",
  port: 443,
  protocol: "https",
};

export function createArweaveClient(opts: ArweaveClientOptions = MAINNET): Arweave {
  return Arweave.init({ ...MAINNET, ...opts });
}

export function generateWallet(client: Arweave): Promise<JWKInterface> {
  return client.wallets.generate();
}

export interface PublishResult {
  id: string;
}

/**
 * Write a signed listing to Arweave. `wallet` pays for and authorizes the
 * underlying transaction — it does NOT need to belong to the listing's
 * publisher (see module comment above).
 */
export async function publishListing(
  client: Arweave,
  wallet: JWKInterface,
  listing: SignedListing,
): Promise<PublishResult> {
  if (!verifyListing(listing)) {
    throw new Error("refusing to publish a listing with an invalid signature");
  }

  const data = JSON.stringify(listing);
  const tx = await client.createTransaction({ data }, wallet);

  tx.addTag("Content-Type", "application/json");
  tx.addTag("App-Name", APP_NAME);
  tx.addTag("Protocol-Version", LISTING_SCHEMA_VERSION);
  tx.addTag("Kind", listing.kind);
  tx.addTag("Publisher", listing.publisher);
  for (const capability of listing.capabilities) {
    tx.addTag("Capability", capability);
  }

  await client.transactions.sign(tx, wallet);
  const response = await client.transactions.post(tx);
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`Arweave rejected the transaction: ${response.status} ${response.statusText}`);
  }
  return { id: tx.id };
}

/** Fetch and parse a listing by its Arweave transaction id. Does NOT verify the signature — call verifyListing yourself. */
export async function fetchListing(client: Arweave, txId: string): Promise<SignedListing> {
  const raw = await client.transactions.getData(txId, { decode: true, string: true });
  return JSON.parse(raw as string) as SignedListing;
}

export interface ListingQuery {
  publisher?: string;
  kind?: "tool" | "agent";
  capability?: string;
  limit?: number;
}

interface GraphQLEdge {
  node: { id: string };
}

/**
 * Query the gateway's GraphQL endpoint for listing transaction ids matching
 * simple tag filters. This is a convenience lookup, NOT the discovery
 * index described in spec §4.4 — it depends on one gateway's GraphQL
 * service being available and is only as complete as that gateway's view
 * of the chain. A real index (Phase 3) should scan the chain directly and
 * be rebuildable independent of any single gateway.
 */
export async function queryListingIds(
  gatewayUrl: string,
  query: ListingQuery = {},
): Promise<string[]> {
  const tagFilters = [`{ name: "App-Name", values: ["${APP_NAME}"] }`];
  if (query.publisher) tagFilters.push(`{ name: "Publisher", values: ["${query.publisher}"] }`);
  if (query.kind) tagFilters.push(`{ name: "Kind", values: ["${query.kind}"] }`);
  if (query.capability) tagFilters.push(`{ name: "Capability", values: ["${query.capability}"] }`);

  const gql = `
    query {
      transactions(tags: [${tagFilters.join(", ")}], first: ${query.limit ?? 100}) {
        edges { node { id } }
      }
    }
  `;

  const res = await fetch(`${gatewayUrl}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL query failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { data: { transactions: { edges: GraphQLEdge[] } } };
  return json.data.transactions.edges.map((edge) => edge.node.id);
}
