// Simple keyword search over a local index (spec §4.4 explicitly allows
// "embeddings + vector search, or simpler keyword search" — this is the
// simpler option, chosen so the reference index has no external
// dependency like an embeddings API). Nothing stops another
// implementation from building a fancier search over the same index file
// format, or over its own independently-scanned copy of the same data.

import type { IndexFile, IndexRecord } from "./store.js";
import type { ListingKind } from "../registry/listing.js";

export interface SearchOptions {
  kind?: ListingKind;
  capability?: string;
  limit?: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function termFrequencies(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of tokenize(text)) {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return counts;
}

function score(record: IndexRecord, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 1;
  const haystack = termFrequencies(
    [record.listing.name, record.listing.description, record.listing.capabilities.join(" ")].join(" "),
  );
  let total = 0;
  for (const term of queryTerms) {
    total += haystack.get(term) ?? 0;
  }
  return total;
}

export function search(index: IndexFile, query: string, opts: SearchOptions = {}): IndexRecord[] {
  const queryTerms = tokenize(query);
  return index.records
    .filter((r) => !opts.kind || r.listing.kind === opts.kind)
    .filter((r) => !opts.capability || r.listing.capabilities.includes(opts.capability))
    .map((r) => ({ record: r, score: score(r, queryTerms) }))
    .filter((x) => queryTerms.length === 0 || x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 20)
    .map((x) => x.record);
}
