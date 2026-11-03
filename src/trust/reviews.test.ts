import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { MiniRelay } from "../coordination/miniRelay.js";
import { closePool } from "../coordination/relay.js";
import { createIdentity } from "../identity/keys.js";
import { fetchReviews, listingExternalId, publishReview, KIND_REVIEW, LISTING_ID_KIND } from "./reviews.js";

let relay: MiniRelay;
let relays: string[];

before(async () => {
  relay = new MiniRelay(7902);
  await relay.start();
  relays = [relay.url];
});

after(async () => {
  closePool(relays);
  await relay.stop();
});

describe("trust/reviews", () => {
  test("review references its listing with an indexable NIP-73 i/k tag pair", async () => {
    const event = await publishReview(createIdentity(), "abc_DEF-123", { rating: 1 }, relays);
    assert.equal(event.kind, KIND_REVIEW);
    assert.deepEqual(event.tags.find((t) => t[0] === "i"), ["i", "arweave:tx:abc_DEF-123"]);
    assert.deepEqual(event.tags.find((t) => t[0] === "k"), ["k", LISTING_ID_KIND]);
    // Anything a relay must filter on has to be a single-letter tag (NIP-01).
    for (const [name] of event.tags) if (name !== "proto") assert.match(name, /^[a-zA-Z]$/);
  });

  test("publishReview -> fetchReviews round-trips and only returns reviews of that listing", async () => {
    const listing = `listing-${Date.now()}`;
    const reviewer = createIdentity();
    await publishReview(reviewer, listing, { rating: 1, comment: "works" }, relays);
    await publishReview(createIdentity(), listing, { rating: -1 }, relays);
    await publishReview(createIdentity(), `${listing}-other`, { rating: 0 }, relays);

    const reviews = await fetchReviews(listing, relays);
    assert.equal(reviews.length, 2);
    assert.ok(reviews.every((r) => r.listingTxId === listing));
    const mine = reviews.find((r) => r.reviewer === reviewer.publicKeyHex);
    assert.equal(mine?.rating, 1);
    assert.equal(mine?.comment, "works");
  });

  test("listing ids stay case-sensitive (Arweave ids are base64url)", async () => {
    const lower = `case-${Date.now()}-abc`;
    const upper = lower.toUpperCase();
    await publishReview(createIdentity(), lower, { rating: 1 }, relays);
    await publishReview(createIdentity(), upper, { rating: -1 }, relays);
    assert.deepEqual((await fetchReviews(lower, relays)).map((r) => r.rating), [1]);
    assert.equal(listingExternalId(upper), `arweave:tx:${upper}`);
  });

  test("the test relay rejects multi-letter tag filters, like real relays do", async () => {
    const ws = new WebSocket(relay.url);
    await new Promise((resolve) => ws.once("open", resolve));
    const reply = new Promise<unknown[]>((resolve) => ws.once("message", (raw) => resolve(JSON.parse(raw.toString()))));
    ws.send(JSON.stringify(["REQ", "s", { kinds: [KIND_REVIEW], "#listing": ["x"] }]));
    const msg = await reply;
    ws.close();
    assert.equal(msg[0], "CLOSED");
    assert.equal(msg[1], "s");
  });
});
