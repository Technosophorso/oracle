// Index file format for the discovery layer (spec §4.4). This is a plain
// JSON snapshot, not a database server — the whole point is that anyone
// can produce one independently by rescanning the Arweave log (see
// scan.ts), so the file format just needs to be simple and inspectable,
// not authoritative.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { SignedListing } from "../registry/listing.js";

export const INDEX_FORMAT_VERSION = "oracle-index/1";

export interface IndexRecord {
  txId: string;
  blockHeight: number | null;
  blockTimestamp: number | null;
  listing: SignedListing;
  /** When THIS indexer processed the record — not authoritative, just local bookkeeping. */
  indexedAt: string;
}

export interface IndexFile {
  formatVersion: typeof INDEX_FORMAT_VERSION;
  /** Which gateway this index was built by scanning. Two indexes built from different gateways over the same chain should still converge on the same `records` (modulo gateway lag) — that convergence is the property worth checking, not byte-identical files. */
  gatewayUrl: string;
  /** GraphQL pagination cursor of the last edge processed, so a re-run of `build` can resume instead of rescanning everything. `--rebuild` ignores this and starts over. */
  cursor: string | null;
  records: IndexRecord[];
}

export function createEmptyIndex(gatewayUrl: string): IndexFile {
  return { formatVersion: INDEX_FORMAT_VERSION, gatewayUrl, cursor: null, records: [] };
}

export function loadIndex(path: string, gatewayUrl: string): IndexFile {
  if (!existsSync(path)) return createEmptyIndex(gatewayUrl);
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as IndexFile;
  if (parsed.formatVersion !== INDEX_FORMAT_VERSION) {
    throw new Error(
      `index file ${path} has format ${parsed.formatVersion}, expected ${INDEX_FORMAT_VERSION}`,
    );
  }
  return parsed;
}

export function saveIndex(path: string, index: IndexFile): void {
  writeFileSync(path, JSON.stringify(index, null, 2), "utf-8");
}
