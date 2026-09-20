import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { search } from "./search.js";
import type { IndexFile, IndexRecord } from "./store.js";
import type { SignedListing } from "../registry/listing.js";

function fakeListing(overrides: Partial<SignedListing>): SignedListing {
  return {
    schemaVersion: "oracle-listing/1",
    kind: "tool",
    name: "unnamed",
    description: "",
    capabilities: [],
    interface: { transport: "http", spec: {} },
    publisher: "pub",
    createdAt: "2026-01-01T00:00:00.000Z",
    signature: "sig",
    ...overrides,
  };
}

function fakeRecord(overrides: Partial<SignedListing>, txId = overrides.name ?? "tx"): IndexRecord {
  return {
    txId,
    blockHeight: 1,
    blockTimestamp: 1,
    listing: fakeListing(overrides),
    indexedAt: "2026-01-01T00:00:00.000Z",
  };
}

function indexOf(records: IndexRecord[]): IndexFile {
  return { formatVersion: "oracle-index/1", gatewayUrl: "test", cursor: null, records };
}

describe("discovery/search", () => {
  const pdfTool = fakeRecord({
    name: "pdf-summarizer",
    description: "Summarizes a PDF into bullet points.",
    capabilities: ["pdf", "summarization"],
    kind: "tool",
  });
  const csvTool = fakeRecord({
    name: "csv-cleaner",
    description: "Cleans messy CSV files.",
    capabilities: ["csv", "data-cleaning"],
    kind: "tool",
  });
  const researchAgent = fakeRecord({
    name: "research-agent",
    description: "General-purpose research and summarization agent.",
    capabilities: ["research", "summarization"],
    kind: "agent",
  });
  const index = indexOf([pdfTool, csvTool, researchAgent]);

  test("empty query with no filters returns everything", () => {
    const results = search(index, "");
    assert.equal(results.length, 3);
  });

  test("matches on capability keyword and ranks by term frequency", () => {
    const results = search(index, "summarization");
    assert.deepEqual(
      results.map((r) => r.txId),
      [researchAgent.txId, pdfTool.txId],
    );
  });

  test("returns nothing for a term that matches no listing", () => {
    const results = search(index, "nonexistent-keyword-xyz");
    assert.equal(results.length, 0);
  });

  test("filters by kind", () => {
    const results = search(index, "", { kind: "agent" });
    assert.deepEqual(
      results.map((r) => r.txId),
      [researchAgent.txId],
    );
  });

  test("filters by exact capability", () => {
    const results = search(index, "", { capability: "csv" });
    assert.deepEqual(
      results.map((r) => r.txId),
      [csvTool.txId],
    );
  });

  test("combines a query with a filter", () => {
    const results = search(index, "summarization", { kind: "tool" });
    assert.deepEqual(
      results.map((r) => r.txId),
      [pdfTool.txId],
    );
  });

  test("respects the limit option", () => {
    const results = search(index, "", { limit: 1 });
    assert.equal(results.length, 1);
  });

  test("search is case-insensitive", () => {
    const results = search(index, "PDF");
    assert.deepEqual(
      results.map((r) => r.txId),
      [pdfTool.txId],
    );
  });
});
