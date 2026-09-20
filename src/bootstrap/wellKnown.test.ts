import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildWellKnown, validateWellKnown, WELL_KNOWN_FORMAT_VERSION } from "./wellKnown.js";

const docs = {
  nip: "https://example.com/nip.md",
  protocol: "https://example.com/PROTOCOL.md",
  registry: "https://example.com/REGISTRY.md",
  discovery: "https://example.com/DISCOVERY.md",
};

describe("bootstrap/wellKnown", () => {
  test("buildWellKnown produces a document that validates", () => {
    const doc = buildWellKnown({
      name: "test-node",
      relays: ["wss://relay.example.com"],
      howToPublish: "https://example.com/how",
      docs,
    });
    const result = validateWellKnown(doc);
    assert.deepEqual(result, { valid: true, errors: [] });
  });

  test("buildWellKnown defaults registryBackend to arweave", () => {
    const doc = buildWellKnown({ name: "n", relays: [], howToPublish: "x", docs });
    assert.equal(doc.registryBackend, "arweave");
  });

  test("validateWellKnown rejects a non-object", () => {
    assert.equal(validateWellKnown(null).valid, false);
    assert.equal(validateWellKnown("a string").valid, false);
    assert.equal(validateWellKnown(42).valid, false);
  });

  test("validateWellKnown rejects a wrong formatVersion", () => {
    const doc = buildWellKnown({ name: "n", relays: [], howToPublish: "x", docs });
    const bad = { ...doc, formatVersion: "something-else" };
    const result = validateWellKnown(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(WELL_KNOWN_FORMAT_VERSION)));
  });

  test("validateWellKnown reports every missing required field", () => {
    const result = validateWellKnown({ formatVersion: WELL_KNOWN_FORMAT_VERSION });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 5);
  });

  test("validateWellKnown reports missing docs sub-fields individually", () => {
    const doc = buildWellKnown({ name: "n", relays: [], howToPublish: "x", docs });
    const bad = { ...doc, docs: { nip: docs.nip } };
    const result = validateWellKnown(bad);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e === "docs.protocol is required"));
    assert.ok(result.errors.some((e) => e === "docs.registry is required"));
    assert.ok(result.errors.some((e) => e === "docs.discovery is required"));
  });

  test("validateWellKnown allows unknown extra fields (forward compatibility)", () => {
    const doc = buildWellKnown({ name: "n", relays: [], howToPublish: "x", docs });
    const withExtra = { ...doc, somethingFromTheFuture: true };
    assert.equal(validateWellKnown(withExtra).valid, true);
  });

  test("validateWellKnown rejects relays that aren't an array of strings", () => {
    const doc = buildWellKnown({ name: "n", relays: [], howToPublish: "x", docs });
    const bad = { ...doc, relays: ["ok", 123] };
    assert.equal(validateWellKnown(bad).valid, false);
  });
});
