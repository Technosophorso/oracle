#!/usr/bin/env tsx
// Minimal CLI for building and querying a local discovery index.
//
//   tsx src/discovery/cli.ts build [--gateway url] [--out file] [--rebuild]
//   tsx src/discovery/cli.ts search <query> [--kind tool|agent] [--capability x] [--index file] [--limit n]
//
// `build` is safe to re-run: by default it resumes from the saved cursor
// and only processes new listings. `--rebuild` ignores the saved index
// entirely and rescans from the beginning — this is the operation that
// proves the index is reproducible by anyone, not just incrementally
// maintainable by whoever built it first.

import { createArweaveClient, MAINNET } from "../registry/arweave.js";
import { scanAndIndex } from "./scan.js";
import { createEmptyIndex, loadIndex, saveIndex } from "./store.js";
import { search } from "./search.js";
import type { ListingKind } from "../registry/listing.js";

const DEFAULT_INDEX_PATH = "index.json";

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
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

  if (cmd === "build") {
    const gateway = getFlag(rest, "gateway") ?? `https://${MAINNET.host}`;
    const outPath = getFlag(rest, "out") ?? DEFAULT_INDEX_PATH;
    const client = clientFromGateway(gateway);
    const existing = hasFlag(rest, "rebuild") ? createEmptyIndex(gateway) : loadIndex(outPath, gateway);

    console.log(`Scanning ${gateway} from cursor: ${existing.cursor ?? "(beginning)"}`);
    const updated = await scanAndIndex(client, gateway, existing, {
      onProgress: ({ processed, added, rejected }) =>
        process.stdout.write(`\rprocessed ${processed}, added ${added}, rejected ${rejected}`),
    });
    process.stdout.write("\n");

    saveIndex(outPath, updated);
    console.log(`Saved ${updated.records.length} listing(s) to ${outPath}`);
    return;
  }

  if (cmd === "search") {
    const [query] = rest;
    if (!query) throw new Error("usage: search <query> [--kind tool|agent] [--capability x] [--index file] [--limit n]");
    const indexPath = getFlag(rest, "index") ?? DEFAULT_INDEX_PATH;
    const index = loadIndex(indexPath, "");
    const results = search(index, query, {
      kind: getFlag(rest, "kind") as ListingKind | undefined,
      capability: getFlag(rest, "capability"),
      limit: getFlag(rest, "limit") ? Number(getFlag(rest, "limit")) : undefined,
    });
    for (const r of results) {
      console.log(`${r.txId}  [${r.listing.kind}] ${r.listing.name} — ${r.listing.description}`);
    }
    console.log(`\n${results.length} result(s)`);
    return;
  }

  console.error("Usage:");
  console.error("  tsx src/discovery/cli.ts build [--gateway url] [--out file] [--rebuild]");
  console.error("  tsx src/discovery/cli.ts search <query> [--kind tool|agent] [--capability x] [--index file] [--limit n]");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
