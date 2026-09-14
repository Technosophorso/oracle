#!/usr/bin/env tsx
// Minimal CLI for publishing/fetching registry listings.
//
//   tsx src/registry/cli.ts wallet:new <output-file>
//   tsx src/registry/cli.ts publish <identity-file> <wallet-file> <listing-fields.json> [--gateway url]
//   tsx src/registry/cli.ts fetch <tx-id> [--gateway url]
//   tsx src/registry/cli.ts query [--publisher hex] [--kind tool|agent] [--capability x] [--gateway url]
//
// `listing-fields.json` holds everything except schemaVersion/publisher
// (filled in from the identity file), e.g.:
//   {
//     "kind": "tool",
//     "name": "pdf-summarizer",
//     "description": "...",
//     "capabilities": ["pdf", "summarization"],
//     "interface": { "transport": "http", "spec": { "url": "..." } },
//     "createdAt": "2026-09-14T12:00:00.000Z"
//   }

import { readFileSync, writeFileSync } from "node:fs";
import { loadIdentity } from "../identity/keys.js";
import { createListing, verifyListing, type ListingContent } from "./listing.js";
import {
  createArweaveClient,
  generateWallet,
  publishListing,
  fetchListing,
  queryListingIds,
  MAINNET,
} from "./arweave.js";
import type { JWKInterface } from "arweave/node/lib/wallet.js";

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function clientFromGateway(gateway?: string) {
  if (!gateway) return createArweaveClient(MAINNET);
  const url = new URL(gateway);
  return createArweaveClient({
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    protocol: url.protocol === "https:" ? "https" : "http",
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "wallet:new") {
    const [outFile] = rest;
    if (!outFile) throw new Error("usage: wallet:new <output-file>");
    const client = createArweaveClient(MAINNET);
    const wallet = await generateWallet(client);
    writeFileSync(outFile, JSON.stringify(wallet, null, 2), { encoding: "utf-8", mode: 0o600 });
    const address = await client.wallets.jwkToAddress(wallet);
    console.log(`Saved new Arweave wallet to ${outFile}`);
    console.log(`Address: ${address}`);
    return;
  }

  if (cmd === "publish") {
    const [identityFile, walletFile, fieldsFile] = rest;
    if (!identityFile || !walletFile || !fieldsFile) {
      throw new Error("usage: publish <identity-file> <wallet-file> <listing-fields.json> [--gateway url]");
    }
    const identity = loadIdentity(identityFile);
    const wallet = JSON.parse(readFileSync(walletFile, "utf-8")) as JWKInterface;
    const fields = JSON.parse(readFileSync(fieldsFile, "utf-8")) as Omit<
      ListingContent,
      "publisher" | "schemaVersion"
    >;
    const listing = createListing(identity, fields);
    const client = clientFromGateway(getFlag(rest, "gateway"));
    const { id } = await publishListing(client, wallet, listing);
    console.log(`Published tx: ${id}`);
    return;
  }

  if (cmd === "fetch") {
    const [txId] = rest;
    if (!txId) throw new Error("usage: fetch <tx-id> [--gateway url]");
    const client = clientFromGateway(getFlag(rest, "gateway"));
    const listing = await fetchListing(client, txId);
    console.log(JSON.stringify(listing, null, 2));
    console.log(`\nSignature valid: ${verifyListing(listing)}`);
    return;
  }

  if (cmd === "query") {
    const gateway = getFlag(rest, "gateway") ?? `https://${MAINNET.host}`;
    const ids = await queryListingIds(gateway, {
      publisher: getFlag(rest, "publisher"),
      kind: getFlag(rest, "kind") as "tool" | "agent" | undefined,
      capability: getFlag(rest, "capability"),
    });
    console.log(JSON.stringify(ids, null, 2));
    return;
  }

  console.error("Usage:");
  console.error("  tsx src/registry/cli.ts wallet:new <output-file>");
  console.error("  tsx src/registry/cli.ts publish <identity-file> <wallet-file> <listing-fields.json> [--gateway url]");
  console.error("  tsx src/registry/cli.ts fetch <tx-id> [--gateway url]");
  console.error("  tsx src/registry/cli.ts query [--publisher hex] [--kind tool|agent] [--capability x] [--gateway url]");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
