import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createIdentity,
  identityFromSecretKey,
  loadIdentityFromHex,
  loadIdentityFromNsec,
  secretKeyBytes,
} from "./keys.js";

describe("identity/keys", () => {
  test("createIdentity produces a well-formed identity", () => {
    const identity = createIdentity();
    assert.equal(identity.secretKeyHex.length, 64);
    assert.equal(identity.publicKeyHex.length, 64);
    assert.match(identity.nsec, /^nsec1/);
    assert.match(identity.npub, /^npub1/);
  });

  test("createIdentity produces distinct identities each call", () => {
    const a = createIdentity();
    const b = createIdentity();
    assert.notEqual(a.secretKeyHex, b.secretKeyHex);
    assert.notEqual(a.publicKeyHex, b.publicKeyHex);
  });

  test("loadIdentityFromHex round-trips a secret key", () => {
    const original = createIdentity();
    const restored = loadIdentityFromHex(original.secretKeyHex);
    assert.deepEqual(restored, original);
  });

  test("loadIdentityFromNsec round-trips a secret key", () => {
    const original = createIdentity();
    const restored = loadIdentityFromNsec(original.nsec);
    assert.deepEqual(restored, original);
  });

  test("loadIdentityFromNsec rejects a non-nsec bech32 string", () => {
    const original = createIdentity();
    assert.throws(() => loadIdentityFromNsec(original.npub), /expected nsec/);
  });

  test("identityFromSecretKey derives the matching public key", () => {
    const a = createIdentity();
    const b = identityFromSecretKey(secretKeyBytes(a));
    assert.equal(b.publicKeyHex, a.publicKeyHex);
    assert.equal(b.npub, a.npub);
  });

  test("secretKeyBytes returns 32 raw bytes matching the hex encoding", () => {
    const identity = createIdentity();
    const bytes = secretKeyBytes(identity);
    assert.equal(bytes.length, 32);
    assert.equal(Buffer.from(bytes).toString("hex"), identity.secretKeyHex);
  });
});
