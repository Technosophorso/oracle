// End-to-end demo of Phase 2: an agent identity signs a tool listing, it
// gets published to Arweave, fetched back by transaction id, its signature
// verified, and found again via a tag-based GraphQL lookup.
//
// Runs against a throwaway local Arweave testnet (arlocal) so this costs
// nothing and needs no funded wallet or network access — the same
// arweave-js client code in src/registry/arweave.ts talks to mainnet
// unchanged if you swap the gateway config.
//
// Run with: npm run demo:registry

// arlocal ships CJS typings that don't interop cleanly with a plain
// `import ArLocal from "arlocal"` under this project's NodeNext module
// resolution, so it's loaded directly via require instead.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
interface ArLocalInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
}
const ArLocal: new (port?: number, showLogs?: boolean) => ArLocalInstance =
  require("arlocal").default;

import { createIdentity } from "../src/identity/keys.js";
import { createListing, verifyListing } from "../src/registry/listing.js";
import {
  createArweaveClient,
  generateWallet,
  publishListing,
  fetchListing,
  queryListingIds,
} from "../src/registry/arweave.js";

const PORT = 1984;
const GATEWAY = `http://localhost:${PORT}`;

async function main() {
  const arlocal = new ArLocal(PORT, false);
  await arlocal.start();
  console.log(`Local Arweave testnet running at ${GATEWAY}\n`);

  try {
    const client = createArweaveClient({ host: "localhost", port: PORT, protocol: "http" });

    // Storage is paid for by a wallet unrelated to the publisher's identity
    // (see arweave.ts) — mint it some local testnet AR.
    const payerWallet = await generateWallet(client);
    const payerAddress = await client.wallets.jwkToAddress(payerWallet);
    await fetch(`${GATEWAY}/mint/${payerAddress}/${1e12}`);

    // The publisher's actual identity — same keypair type as the coordination layer.
    const publisher = createIdentity();
    console.log(`Publisher npub-equivalent pubkey: ${publisher.publicKeyHex}`);

    const listing = createListing(publisher, {
      kind: "tool",
      name: "pdf-summarizer",
      description: "Summarizes a PDF document into 5 bullet points.",
      capabilities: ["pdf", "summarization", "nlp"],
      interface: {
        transport: "http",
        spec: {
          method: "POST",
          url: "https://example.invalid/summarize",
          requestSchema: { type: "object", properties: { pdfUrl: { type: "string" } } },
        },
      },
      createdAt: new Date().toISOString(),
    });
    console.log(`Listing signature valid (self-check): ${verifyListing(listing)}\n`);

    const { id: txId } = await publishListing(client, payerWallet, listing);
    console.log(`Published to Arweave tx: ${txId}`);

    // arlocal requires an explicit mine step to confirm pending transactions.
    await fetch(`${GATEWAY}/mine`);

    const fetched = await fetchListing(client, txId);
    console.log(`Fetched listing name: ${fetched.name}`);
    console.log(`Fetched listing signature valid: ${verifyListing(fetched)}`);

    const foundIds = await queryListingIds(GATEWAY, { publisher: publisher.publicKeyHex });
    console.log(`GraphQL lookup by publisher found: ${JSON.stringify(foundIds)}`);
    console.log(`Round-trip tx id matches lookup: ${foundIds.includes(txId)}`);
  } finally {
    await arlocal.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
