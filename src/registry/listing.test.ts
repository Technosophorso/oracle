import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createIdentity } from "../identity/keys.js";
import { canonicalize, createListing, verifyListing, LISTING_SCHEMA_VERSION } from "./listing.js";

const baseFields = {
  kind: "tool" as const,
  name: "pdf-summarizer",
  description: "Summarizes a PDF into bullet points.",
  capabilities: ["pdf", "summarization"],
  interface: { transport: "http", spec: { url: "https://example.invalid/summarize" } },
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("registry/listing", () => {
  test("canonicalize sorts object keys recursively", () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
    assert.equal(a, b);
  });

  test("canonicalize preserves array order", () => {
    const a = canonicalize({ list: [3, 1, 2] });
    const b = canonicalize({ list: [1, 2, 3] });
    assert.notEqual(a, b);
  });

  test("createListing fills in schemaVersion and publisher", () => {
    const identity = createIdentity();
    const listing = createListing(identity, baseFields);
    assert.equal(listing.schemaVersion, LISTING_SCHEMA_VERSION);
    assert.equal(listing.publisher, identity.publicKeyHex);
    assert.equal(listing.name, baseFields.name);
  });

  test("createListing produces a listing that verifies", () => {
    const identity = createIdentity();
    const listing = createListing(identity, baseFields);
    assert.equal(verifyListing(listing), true);
  });

  test("verifyListing fails if any field is tampered with after signing", () => {
    const identity = createIdentity();
    const listing = createListing(identity, baseFields);
    const tampered = { ...listing, name: "totally-different-name" };
    assert.equal(verifyListing(tampered), false);
  });

  test("verifyListing fails if the signature itself is corrupted", () => {
    const identity = createIdentity();
    const listing = createListing(identity, baseFields);
    const tampered = { ...listing, signature: "00".repeat(64) };
    assert.equal(verifyListing(tampered), false);
  });

  test("verifyListing fails for a listing signed by a different key than it claims", () => {
    const identity = createIdentity();
    const impostor = createIdentity();
    const listing = createListing(identity, baseFields);
    const relabeled = { ...listing, publisher: impostor.publicKeyHex };
    assert.equal(verifyListing(relabeled), false);
  });

  test("verifyListing rejects an unrecognized schemaVersion", () => {
    const identity = createIdentity();
    const listing = createListing(identity, baseFields);
    const futureVersion = { ...listing, schemaVersion: "oracle-listing/999" as typeof LISTING_SCHEMA_VERSION };
    assert.equal(verifyListing(futureVersion), false);
  });

  test("verifyListing does not throw on a garbage signature value", () => {
    const identity = createIdentity();
    const listing = createListing(identity, baseFields);
    const garbage = { ...listing, signature: "not-hex-at-all" };
    assert.doesNotThrow(() => verifyListing(garbage));
    assert.equal(verifyListing(garbage), false);
  });

  test("two listings with identical content but different capability order verify independently", () => {
    const identity = createIdentity();
    const listingA = createListing(identity, { ...baseFields, capabilities: ["pdf", "summarization"] });
    const listingB = createListing(identity, { ...baseFields, capabilities: ["summarization", "pdf"] });
    assert.equal(verifyListing(listingA), true);
    assert.equal(verifyListing(listingB), true);
    assert.notEqual(listingA.signature, listingB.signature);
  });
});
