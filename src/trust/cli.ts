#!/usr/bin/env tsx
// Minimal CLI for the client-side trust reference tooling.
//
//   tsx src/trust/cli.ts review <identity-file> <listing-tx-id> <rating -1|0|1> [comment] [--relays url,url]
//   tsx src/trust/cli.ts score <listing-tx-id> [--relays url,url] [--half-life-days n]

import { closePool, DEFAULT_RELAYS } from "../coordination/relay.js";
import { loadIdentity } from "../identity/keys.js";
import { publishReview, fetchReviews } from "./reviews.js";
import { fetchContinuity } from "./continuity.js";
import { computeReputation } from "./score.js";
import type { ContinuityInfo } from "./continuity.js";

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function relaysFromFlag(args: string[]): string[] {
  const raw = getFlag(args, "relays");
  return raw ? raw.split(",") : DEFAULT_RELAYS;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "review") {
    const [identityFile, listingTxId, ratingStr, comment] = rest;
    if (!identityFile || !listingTxId || !ratingStr) {
      throw new Error("usage: review <identity-file> <listing-tx-id> <rating -1|0|1> [comment] [--relays url,url]");
    }
    const rating = Number(ratingStr);
    if (rating !== -1 && rating !== 0 && rating !== 1) throw new Error("rating must be -1, 0, or 1");
    const identity = loadIdentity(identityFile);
    const relays = relaysFromFlag(rest);
    await publishReview(identity, listingTxId, { rating: rating as -1 | 0 | 1, comment }, relays);
    console.log(`Published review (${rating}) for ${listingTxId}`);
    closePool(relays);
    return;
  }

  if (cmd === "score") {
    const [listingTxId] = rest;
    if (!listingTxId) throw new Error("usage: score <listing-tx-id> [--relays url,url] [--half-life-days n]");
    const relays = relaysFromFlag(rest);
    const halfLifeDays = getFlag(rest, "half-life-days") ? Number(getFlag(rest, "half-life-days")) : undefined;

    const reviews = await fetchReviews(listingTxId, relays);
    console.log(`Found ${reviews.length} review(s).`);

    const reviewerContinuity = new Map<string, ContinuityInfo>();
    for (const reviewer of new Set(reviews.map((r) => r.reviewer))) {
      reviewerContinuity.set(reviewer, await fetchContinuity(reviewer, { relays }));
    }

    const result = computeReputation(reviews, reviewerContinuity, { halfLifeDays });
    console.log(`Score: ${result.score.toFixed(3)} (range -1..1)`);
    console.log(`Total effective weight: ${result.totalWeight.toFixed(3)} — low means "not enough signal," not "bad"`);
    closePool(relays);
    return;
  }

  console.error("Usage:");
  console.error("  tsx src/trust/cli.ts review <identity-file> <listing-tx-id> <rating -1|0|1> [comment] [--relays url,url]");
  console.error("  tsx src/trust/cli.ts score <listing-tx-id> [--relays url,url] [--half-life-days n]");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
