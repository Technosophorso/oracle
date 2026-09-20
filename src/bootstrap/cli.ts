#!/usr/bin/env tsx
// Generate or validate a .well-known/agent-marketplace.json file.
//
//   tsx src/bootstrap/cli.ts generate <config.json> [--out file]
//   tsx src/bootstrap/cli.ts validate <file>
//
// `config.json` is a WellKnownOptions object, e.g.:
//   {
//     "name": "my-oracle-node",
//     "description": "Community-run marketplace relay + registry mirror",
//     "relays": ["wss://relay.example.com"],
//     "sampleListingTxIds": ["..."],
//     "howToPublish": "https://example.com/docs/REGISTRY.md",
//     "docs": {
//       "nip": "https://example.com/docs/nips/NIP-XX-agent-marketplace.md",
//       "protocol": "https://example.com/docs/PROTOCOL.md",
//       "registry": "https://example.com/docs/REGISTRY.md",
//       "discovery": "https://example.com/docs/DISCOVERY.md"
//     }
//   }

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildWellKnown, validateWellKnown, WELL_KNOWN_PATH, type WellKnownOptions } from "./wellKnown.js";

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "generate") {
    const [configFile] = rest;
    if (!configFile) throw new Error("usage: generate <config.json> [--out file]");
    const opts = JSON.parse(readFileSync(configFile, "utf-8")) as WellKnownOptions;
    const doc = buildWellKnown(opts);
    const outPath = getFlag(rest, "out") ?? WELL_KNOWN_PATH;
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf-8");
    console.log(`Wrote ${outPath}`);
    return;
  }

  if (cmd === "validate") {
    const [file] = rest;
    if (!file) throw new Error("usage: validate <file>");
    const doc = JSON.parse(readFileSync(file, "utf-8"));
    const result = validateWellKnown(doc);
    if (result.valid) {
      console.log("valid");
    } else {
      console.log("invalid:");
      for (const err of result.errors) console.log(`  - ${err}`);
      process.exit(1);
    }
    return;
  }

  console.error("Usage:");
  console.error("  tsx src/bootstrap/cli.ts generate <config.json> [--out file]");
  console.error("  tsx src/bootstrap/cli.ts validate <file>");
  process.exit(1);
}

main();
