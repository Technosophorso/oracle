// End-to-end demo of Phase 5's trust heuristics: two reviewers leave
// opposite opinions on the same (fake, for this demo) listing — one from
// an identity with fabricated long-running history, one freshly minted
// with zero history — and the recency/continuity-weighted score shows the
// established identity's review dominating, while a lone fresh Sybil
// barely moves the needle.
//
// This does NOT prove Sybil resistance in general (spec §8 is explicit
// that this is unsolved without a financial layer) — it only shows the
// reference heuristic raises the cost of an attack from "mint one key"
// to "mint many keys and still lose to one established reviewer," which
// is the most the spec claims for client-side trust tooling.
//
// Runs against a local, in-memory Nostr relay (miniRelay.ts) instead of
// public relays so timestamps can be controlled precisely and the demo is
// fast and deterministic.
//
// Run with: npm run demo:trust

import { finalizeEvent } from "nostr-tools/pure";
import { MiniRelay } from "../src/coordination/miniRelay.js";
import { createIdentity, secretKeyBytes } from "../src/identity/keys.js";
import { publishReview, fetchReviews } from "../src/trust/reviews.js";
import { fetchContinuity, continuityScore } from "../src/trust/continuity.js";
import { computeReputation } from "../src/trust/score.js";
import { closePool, getPool } from "../src/coordination/relay.js";
import type { ContinuityInfo } from "../src/trust/continuity.js";

const PORT = 7777;
const FAKE_LISTING_TX_ID = "demo-listing-tx-id";
const DAY = 86400;

async function main() {
  const relay = new MiniRelay(PORT);
  await relay.start();
  const relays = [relay.url];
  console.log(`Local mini relay running at ${relay.url}\n`);

  try {
    const alice = createIdentity(); // established reviewer
    const mallory = createIdentity(); // freshly-minted Sybil reviewer
    const now = Math.floor(Date.now() / 1000);

    console.log("Fabricating 40 days of history for Alice (backdated kind:1 notes)...");
    const pool = getPool();
    for (const daysAgo of [40, 30, 20, 10, 2]) {
      const event = finalizeEvent(
        { kind: 1, created_at: now - daysAgo * DAY, tags: [], content: "just chatting" },
        secretKeyBytes(alice),
      );
      await Promise.allSettled(pool.publish(relays, event));
    }
    console.log("Mallory has published nothing before her review — zero observed history.\n");

    console.log("Alice reviews the listing: +1");
    await publishReview(alice, FAKE_LISTING_TX_ID, { rating: 1, comment: "Works great." }, relays);
    console.log("Mallory reviews the same listing: -1");
    await publishReview(mallory, FAKE_LISTING_TX_ID, { rating: -1, comment: "Terrible, avoid!" }, relays);

    await sleep(300); // let the relay's in-memory store settle

    const reviews = await fetchReviews(FAKE_LISTING_TX_ID, relays);
    console.log(`\nFound ${reviews.length} review(s).`);

    const continuity = new Map<string, ContinuityInfo>();
    for (const reviewer of new Set(reviews.map((r) => r.reviewer))) {
      continuity.set(reviewer, await fetchContinuity(reviewer, { relays }));
    }

    const aliceContinuity = continuity.get(alice.publicKeyHex)!;
    const malloryContinuity = continuity.get(mallory.publicKeyHex)!;
    console.log(
      `Alice continuity score: ${continuityScore(aliceContinuity, now).toFixed(3)} ` +
        `(first seen ${Math.round((now - aliceContinuity.firstSeen!) / DAY)} days ago, ${aliceContinuity.eventCount} events)`,
    );
    console.log(
      `Mallory continuity score: ${continuityScore(malloryContinuity, now).toFixed(3)} ` +
        `(${malloryContinuity.eventCount} event(s) found total, including the review itself just now)`,
    );

    const result = computeReputation(reviews, continuity, { now });
    console.log(`\nWeighted reputation score: ${result.score.toFixed(3)} (range -1..1, positive despite a -1 vote)`);
    console.log(`Total effective weight: ${result.totalWeight.toFixed(3)}`);

    console.log("\n--- Now simulate 4 more freshly-minted Sybils all voting -1 ---");
    for (let i = 0; i < 4; i++) {
      const sybil = createIdentity();
      await publishReview(sybil, FAKE_LISTING_TX_ID, { rating: -1 }, relays);
    }
    await sleep(300);
    const reviews2 = await fetchReviews(FAKE_LISTING_TX_ID, relays);
    const continuity2 = new Map<string, ContinuityInfo>();
    for (const reviewer of new Set(reviews2.map((r) => r.reviewer))) {
      continuity2.set(reviewer, await fetchContinuity(reviewer, { relays }));
    }
    const result2 = computeReputation(reviews2, continuity2, { now });
    console.log(`Score with 5 fresh Sybils (1 original + 4 new) vs. 1 established reviewer: ${result2.score.toFixed(3)}`);
    console.log("(Still meaningfully influenced by Alice's weight — but note this is a matter of degree,");
    console.log(" not a solved problem: enough Sybils would eventually flip it. See spec §8.)");
  } finally {
    closePool([relay.url]);
    await relay.stop();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
