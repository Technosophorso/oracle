import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmptyIndex, loadIndex, saveIndex, INDEX_FORMAT_VERSION } from "./store.js";

const dir = mkdtempSync(join(tmpdir(), "oracle-store-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("discovery/store", () => {
  test("createEmptyIndex has the current format version and no records", () => {
    const index = createEmptyIndex("https://example.invalid");
    assert.equal(index.formatVersion, INDEX_FORMAT_VERSION);
    assert.equal(index.cursor, null);
    assert.deepEqual(index.records, []);
  });

  test("loadIndex returns an empty index for a nonexistent file", () => {
    const index = loadIndex(join(dir, "does-not-exist.json"), "https://example.invalid");
    assert.deepEqual(index.records, []);
  });

  test("saveIndex then loadIndex round-trips", () => {
    const path = join(dir, "roundtrip.json");
    const original = createEmptyIndex("https://example.invalid");
    original.cursor = "some-cursor";
    saveIndex(path, original);
    const loaded = loadIndex(path, "https://example.invalid");
    assert.deepEqual(loaded, original);
  });

  test("loadIndex throws on a format version mismatch", () => {
    const path = join(dir, "bad-version.json");
    const bad = { ...createEmptyIndex("x"), formatVersion: "oracle-index/999" };
    saveIndex(path, bad as never);
    assert.throws(() => loadIndex(path, "x"), /format oracle-index\/999/);
  });
});
