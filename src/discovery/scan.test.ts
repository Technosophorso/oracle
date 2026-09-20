import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
interface ArLocalInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
}
const ArLocal: new (port?: number, showLogs?: boolean) => ArLocalInstance = require("arlocal").default;

import type Arweave from "arweave";
import type { JWKInterface } from "arweave/node/lib/wallet.js";
import { createIdentity } from "../identity/keys.js";
import { createListing, LISTING_SCHEMA_VERSION, type SignedListing } from "../registry/listing.js";
import { createArweaveClient, generateWallet, publishListing, APP_NAME } from "../registry/arweave.js";
import { scanAndIndex } from "./scan.js";
import { createEmptyIndex } from "./store.js";

const PORT = 1987;
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

async function publishRaw(listing: SignedListing): Promise<string> {
  const tx = await client.createTransaction({ data: JSON.stringify(listing) }, wallet);
  tx.addTag("Content-Type", "application/json");
  tx.addTag("App-Name", APP_NAME);
  tx.addTag("Protocol-Version", LISTING_SCHEMA_VERSION);
  tx.addTag("Kind", listing.kind);
  tx.addTag("Publisher", listing.publisher);
  for (const c of listing.capabilities) tx.addTag("Capability", c);
  await client.transactions.sign(tx, wallet);
  await client.transactions.post(tx);
  return tx.id;
}

function makeListing(name: string) {
  const identity = createIdentity();
  return createListing(identity, {
    kind: "tool",
    name,
    description: "a scan test listing",
    capabilities: ["scan-test"],
    interface: { transport: "http", spec: { url: "https://example.invalid" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("discovery/scan", () => {
  test("scanAndIndex finds a published valid listing and rejects a forged one", async () => {
    const valid = makeListing("scan-valid");
    const forged: SignedListing = { ...makeListing("scan-forged"), signature: "00".repeat(64) };

    const validTxId = (await publishListing(client, wallet, valid)).id;
    const forgedTxId = await publishRaw(forged);
    await fetch(`${GATEWAY}/mine`);

    const index = await scanAndIndex(client, GATEWAY, createEmptyIndex(GATEWAY));
    const ids = new Set(index.records.map((r) => r.txId));

    assert.ok(ids.has(validTxId), "valid listing should be indexed");
    assert.ok(!ids.has(forgedTxId), "forged listing must be rejected");
  });

  test("two independent fresh scans converge on the same valid-listing set", async () => {
    const listing = makeListing("scan-convergence");
    const txId = (await publishListing(client, wallet, listing)).id;
    await fetch(`${GATEWAY}/mine`);

    const indexA = await scanAndIndex(client, GATEWAY, createEmptyIndex(GATEWAY));
    const indexB = await scanAndIndex(client, GATEWAY, createEmptyIndex(GATEWAY));

    const idsA = new Set(indexA.records.map((r) => r.txId));
    const idsB = new Set(indexB.records.map((r) => r.txId));
    assert.deepEqual(idsA, idsB);
    assert.ok(idsA.has(txId));
  });

  test("resuming from a saved cursor only adds newly-published listings, without duplicating old ones", async () => {
    const first = makeListing("scan-cursor-first");
    const firstTxId = (await publishListing(client, wallet, first)).id;
    await fetch(`${GATEWAY}/mine`);

    const firstPass = await scanAndIndex(client, GATEWAY, createEmptyIndex(GATEWAY));
    const countAfterFirst = firstPass.records.length;
    assert.ok(firstPass.records.some((r) => r.txId === firstTxId));

    const second = makeListing("scan-cursor-second");
    const secondTxId = (await publishListing(client, wallet, second)).id;
    await fetch(`${GATEWAY}/mine`);

    const secondPass = await scanAndIndex(client, GATEWAY, firstPass);
    assert.equal(secondPass.records.length, countAfterFirst + 1);
    assert.ok(secondPass.records.some((r) => r.txId === secondTxId));
    // No duplicate entries for the first listing.
    assert.equal(secondPass.records.filter((r) => r.txId === firstTxId).length, 1);
  });

  test("a listing whose data is not valid JSON is skipped, not thrown", async () => {
    const identity = createIdentity();
    const tx = await client.createTransaction({ data: "not json at all" }, wallet);
    tx.addTag("App-Name", APP_NAME);
    tx.addTag("Kind", "tool");
    tx.addTag("Publisher", identity.publicKeyHex);
    await client.transactions.sign(tx, wallet);
    await client.transactions.post(tx);
    await fetch(`${GATEWAY}/mine`);

    const index = await scanAndIndex(client, GATEWAY, createEmptyIndex(GATEWAY));
    assert.ok(!index.records.some((r) => r.txId === tx.id));
  });

  test("onProgress is called with monotonically increasing processed counts", async () => {
    const listing = makeListing("scan-progress");
    await publishListing(client, wallet, listing);
    await fetch(`${GATEWAY}/mine`);

    const calls: number[] = [];
    await scanAndIndex(client, GATEWAY, createEmptyIndex(GATEWAY), {
      onProgress: ({ processed }) => calls.push(processed),
    });
    assert.ok(calls.length > 0);
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i] >= calls[i - 1]);
  });
});
