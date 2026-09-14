// End-to-end demo of Phase 3: build a discovery index by scanning the
// Arweave listing log, then prove the two properties spec §4.4 actually
// cares about:
//
//   1. Rebuildable: a second, totally independent scan from scratch
//      (fresh empty index, same gateway) converges on the same set of
//      valid listings as the first — nobody needs to trust whoever built
//      an index first, they can just build their own and compare.
//   2. Verify, don't trust: a listing with a forged/corrupted signature
//      gets published to the chain like any other transaction (nothing
//      stops that — no gatekeeping), but the indexer silently drops it
//      because it fails signature verification, the same way a Nostr
//      relay drops an invalid event.
//
// Runs against a throwaway local Arweave testnet (arlocal) — no funded
// wallet or real cost involved.
//
// Run with: npm run demo:discovery

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
interface ArLocalInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
}
const ArLocal: new (port?: number, showLogs?: boolean) => ArLocalInstance = require("arlocal").default;

import type Arweave from "arweave";
import type { JWKInterface } from "arweave/node/lib/wallet.js";
import { createIdentity } from "../src/identity/keys.js";
import { createListing, LISTING_SCHEMA_VERSION, type SignedListing } from "../src/registry/listing.js";
import { createArweaveClient, generateWallet, publishListing, APP_NAME } from "../src/registry/arweave.js";
import { scanAndIndex } from "../src/discovery/scan.js";
import { createEmptyIndex } from "../src/discovery/store.js";
import { search } from "../src/discovery/search.js";

const PORT = 1985;
const GATEWAY = `http://localhost:${PORT}`;

/** Publish a listing's raw bytes to Arweave WITHOUT going through publishListing's signature check — used here only to simulate a malicious/broken publisher forging a listing. */
async function publishRaw(client: Arweave, wallet: JWKInterface, listing: SignedListing): Promise<string> {
  const tx = await client.createTransaction({ data: JSON.stringify(listing) }, wallet);
  tx.addTag("Content-Type", "application/json");
  tx.addTag("App-Name", APP_NAME);
  tx.addTag("Protocol-Version", LISTING_SCHEMA_VERSION);
  tx.addTag("Kind", listing.kind);
  tx.addTag("Publisher", listing.publisher);
  for (const c of listing.capabilities) tx.addTag("Capability", c);
  await client.transactions.sign(tx, wallet);
  await client.transactions.post(tx);
  return tx.id;
}

async function main() {
  const arlocal = new ArLocal(PORT, false);
  await arlocal.start();
  console.log(`Local Arweave testnet running at ${GATEWAY}\n`);

  try {
    const client = createArweaveClient({ host: "localhost", port: PORT, protocol: "http" });
    const payerWallet = await generateWallet(client);
    const payerAddress = await client.wallets.jwkToAddress(payerWallet);
    await fetch(`${GATEWAY}/mint/${payerAddress}/${1e13}`);

    // Two honest publishers, three legitimate listings.
    const alice = createIdentity();
    const bob = createIdentity();

    const listing1 = createListing(alice, {
      kind: "tool",
      name: "pdf-summarizer",
      description: "Summarizes a PDF document into 5 bullet points.",
      capabilities: ["pdf", "summarization", "nlp"],
      interface: { transport: "http", spec: { url: "https://example.invalid/summarize" } },
      createdAt: new Date().toISOString(),
    });
    const listing2 = createListing(bob, {
      kind: "tool",
      name: "csv-cleaner",
      description: "Cleans and normalizes messy CSV files.",
      capabilities: ["csv", "data-cleaning"],
      interface: { transport: "http", spec: { url: "https://example.invalid/clean" } },
      createdAt: new Date().toISOString(),
    });
    const listing3 = createListing(bob, {
      kind: "agent",
      name: "bob-research-agent",
      description: "General-purpose research and summarization agent.",
      capabilities: ["research", "summarization"],
      interface: { transport: "nostr-dm", spec: { pubkey: bob.publicKeyHex } },
      createdAt: new Date().toISOString(),
    });

    console.log("Publishing 3 legitimate listings...");
    const tx1 = (await publishListing(client, payerWallet, listing1)).id;
    const tx2 = (await publishListing(client, payerWallet, listing2)).id;
    const tx3 = (await publishListing(client, payerWallet, listing3)).id;

    // A forged listing: claims to be published by `alice`, but the
    // signature is garbage. publishListing() itself would refuse this
    // (it verifies before publishing) — bypass it directly, since nothing
    // on the OPEN CHAIN stops anyone from posting garbage; the protocol's
    // defense is verification at read time, not gatekeeping at write time.
    const forged: SignedListing = {
      ...listing1,
      name: "totally-not-a-scam",
      signature: "00".repeat(64),
    };
    console.log("Publishing 1 forged listing (bad signature, bypasses publishListing's own check)...");
    const forgedTxId = await publishRaw(client, payerWallet, forged);

    await fetch(`${GATEWAY}/mine`);

    console.log("\nBuilding index A (fresh scan)...");
    const indexA = await scanAndIndex(client, GATEWAY, createEmptyIndex(GATEWAY));

    console.log("Building index B (independent fresh scan, simulating a second operator)...");
    const indexB = await scanAndIndex(client, GATEWAY, createEmptyIndex(GATEWAY));

    const idsA = new Set(indexA.records.map((r) => r.txId));
    const idsB = new Set(indexB.records.map((r) => r.txId));
    const sameSize = idsA.size === idsB.size;
    const sameMembers = [...idsA].every((id) => idsB.has(id));
    console.log(`\nIndex A has ${idsA.size} valid listing(s), index B has ${idsB.size}.`);
    console.log(`Independent rebuild converges on the same set: ${sameSize && sameMembers}`);

    console.log(`\nLegitimate listings all present: ${[tx1, tx2, tx3].every((id) => idsA.has(id))}`);
    console.log(`Forged listing was rejected (not in index): ${!idsA.has(forgedTxId)}`);

    const results = search(indexA, "summarization");
    console.log(`\nSearch "summarization" -> ${results.length} result(s):`);
    for (const r of results) {
      console.log(`  [${r.listing.kind}] ${r.listing.name}: ${r.listing.description}`);
    }
  } finally {
    await arlocal.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
