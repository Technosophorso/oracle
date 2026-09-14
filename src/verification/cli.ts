#!/usr/bin/env tsx
// Minimal CLI for automated tool verification.
//
//   tsx src/verification/cli.ts check <tx-id> [--gateway url] [--timeout ms]

import { createArweaveClient, fetchListing, MAINNET } from "../registry/arweave.js";
import { verifyListing as verifySignature } from "../registry/listing.js";
import { verifyHttpListing } from "./httpVerifier.js";

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function clientFromGateway(gateway: string) {
  const url = new URL(gateway);
  return createArweaveClient({
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    protocol: url.protocol === "https:" ? "https" : "http",
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "check") {
    const [txId] = rest;
    if (!txId) throw new Error("usage: check <tx-id> [--gateway url] [--timeout ms]");
    const gateway = getFlag(rest, "gateway") ?? `https://${MAINNET.host}`;
    const client = clientFromGateway(gateway);

    const listing = await fetchListing(client, txId);
    console.log(`Listing: [${listing.kind}] ${listing.name}`);
    console.log(`Signature valid: ${verifySignature(listing)}`);

    const timeoutMs = getFlag(rest, "timeout") ? Number(getFlag(rest, "timeout")) : undefined;
    const result = await verifyHttpListing(listing, { timeoutMs });
    console.log(`Verification result: ${JSON.stringify(result, null, 2)}`);
    return;
  }

  console.error("Usage:");
  console.error("  tsx src/verification/cli.ts check <tx-id> [--gateway url] [--timeout ms]");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
