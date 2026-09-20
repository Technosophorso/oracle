import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
interface ArLocalInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
}
const ArLocal: new (port?: number, showLogs?: boolean) => ArLocalInstance = require("arlocal").default;

import { createIdentity } from "../identity/keys.js";
import { createListing, verifyListing, type SignedListing } from "./listing.js";
import { createArweaveClient, generateWallet, publishListing, fetchListing, queryListingIds } from "./arweave.js";
import type Arweave from "arweave";
import type { JWKInterface } from "arweave/node/lib/wallet.js";

const PORT = 1986;
const GATEWAY = `http://localhost:${PORT}`;

let arlocal: ArLocalInstance;
let client: Arweave;
let wallet: JWKInterface;

before(async () => {
  arlocal = new ArLocal(PORT, false);
  await arlocal.start();
  client = createArweaveClient({ host: "localhost", port: PORT, protocol: "http" });
  wallet = await generateWallet(client);
  const address = await client.wallets.jwkToAddress(wallet);
  await fetch(`${GATEWAY}/mint/${address}/${1e14}`);
});

after(() => arlocal.stop());

function makeListing(overrides: Partial<Parameters<typeof createListing>[1]> = {}) {
  const identity = createIdentity();
  return createListing(identity, {
    kind: "tool",
    name: "test-tool",
    description: "a test tool",
    capabilities: ["testing"],
    interface: { transport: "http", spec: { url: "https://example.invalid" } },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("registry/arweave", () => {
  test("publishListing then fetchListing round-trips the exact listing", async () => {
    const listing = makeListing({ name: "round-trip-tool" });
    const { id } = await publishListing(client, wallet, listing);
    await fetch(`${GATEWAY}/mine`);

    const fetched = await fetchListing(client, id);
    assert.deepEqual(fetched, listing);
    assert.equal(verifyListing(fetched), true);
  });

  test("publishListing refuses to publish a listing with an invalid signature", async () => {
    const listing = makeListing();
    const forged: SignedListing = { ...listing, signature: "00".repeat(64) };
    await assert.rejects(() => publishListing(client, wallet, forged), /invalid signature/);
  });

  test("queryListingIds filters by publisher", async () => {
    const listingA = makeListing({ name: "publisher-filter-a" });
    const listingB = makeListing({ name: "publisher-filter-b" });
    const { id: idA } = await publishListing(client, wallet, listingA);
    const { id: idB } = await publishListing(client, wallet, listingB);
    await fetch(`${GATEWAY}/mine`);

    const foundForA = await queryListingIds(GATEWAY, { publisher: listingA.publisher });
    assert.deepEqual(foundForA, [idA]);
    const foundForB = await queryListingIds(GATEWAY, { publisher: listingB.publisher });
    assert.deepEqual(foundForB, [idB]);
  });

  test("queryListingIds filters by kind and capability", async () => {
    const toolListing = makeListing({ kind: "tool", capabilities: ["unique-cap-x"], name: "kind-filter-tool" });
    const agentListing = makeListing({ kind: "agent", capabilities: ["unique-cap-x"], name: "kind-filter-agent" });
    const { id: toolId } = await publishListing(client, wallet, toolListing);
    const { id: agentId } = await publishListing(client, wallet, agentListing);
    await fetch(`${GATEWAY}/mine`);

    const tools = await queryListingIds(GATEWAY, { capability: "unique-cap-x", kind: "tool" });
    assert.deepEqual(tools, [toolId]);
    const agents = await queryListingIds(GATEWAY, { capability: "unique-cap-x", kind: "agent" });
    assert.deepEqual(agents, [agentId]);
  });

  test("fetchListing throws for a nonexistent transaction id", async () => {
    await assert.rejects(() => fetchListing(client, "0000000000000000000000000000000000000000000"));
  });
});
