import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeReputation } from "./score.js";
import type { ParsedReview } from "./reviews.js";
import type { ContinuityInfo } from "./continuity.js";

const now = 1_800_000_000;

function review(overrides: Partial<ParsedReview>): ParsedReview {
  return {
    reviewer: "reviewer",
    listingTxId: "tx",
    rating: 1,
    createdAt: now,
    raw: {} as ParsedReview["raw"],
    ...overrides,
  };
}

function established(pubkey: string): ContinuityInfo {
  return { pubkey, firstSeen: now - 40 * 86400, lastSeen: now, eventCount: 10 };
}

function fresh(pubkey: string): ContinuityInfo {
  return { pubkey, firstSeen: now, lastSeen: now, eventCount: 1 };
}

describe("trust/score computeReputation", () => {
  test("no reviews yields a neutral score with zero weight", () => {
    const result = computeReputation([], new Map(), { now });
    assert.equal(result.score, 0);
    assert.equal(result.totalWeight, 0);
    assert.equal(result.reviewCount, 0);
  });

  test("a single established reviewer's rating dominates the score", () => {
    const reviews = [review({ reviewer: "alice", rating: 1 })];
    const continuity = new Map([["alice", established("alice")]]);
    const result = computeReputation(reviews, continuity, { now });
    assert.ok(result.score > 0.8);
  });

  test("one established positive reviewer outweighs one fresh negative reviewer", () => {
    const reviews = [review({ reviewer: "alice", rating: 1 }), review({ reviewer: "mallory", rating: -1 })];
    const continuity = new Map([
      ["alice", established("alice")],
      ["mallory", fresh("mallory")],
    ]);
    const result = computeReputation(reviews, continuity, { now });
    assert.ok(result.score > 0, `expected positive score, got ${result.score}`);
  });

  test("an unknown reviewer (no continuity record) is treated as having zero continuity, not an error", () => {
    const reviews = [review({ reviewer: "ghost", rating: 1 })];
    const result = computeReputation(reviews, new Map(), { now });
    assert.ok(result.score > 0);
    assert.ok(result.totalWeight < 0.1, "an unrecorded reviewer should get only the small floor weight");
  });

  test("older reviews are weighted less than recent ones at the same rating", () => {
    const recent = computeReputation(
      [review({ reviewer: "alice", rating: 1, createdAt: now })],
      new Map([["alice", established("alice")]]),
      { now, halfLifeDays: 14 },
    );
    const old = computeReputation(
      [review({ reviewer: "alice", rating: 1, createdAt: now - 28 * 86400 })],
      new Map([["alice", established("alice")]]),
      { now, halfLifeDays: 14 },
    );
    assert.ok(old.totalWeight < recent.totalWeight);
  });

  test("a review exactly one half-life old carries roughly half the weight", () => {
    const fullWeight = computeReputation(
      [review({ reviewer: "alice", rating: 1, createdAt: now })],
      new Map([["alice", established("alice")]]),
      { now, halfLifeDays: 14 },
    ).totalWeight;
    const halfLifeWeight = computeReputation(
      [review({ reviewer: "alice", rating: 1, createdAt: now - 14 * 86400 })],
      new Map([["alice", established("alice")]]),
      { now, halfLifeDays: 14 },
    ).totalWeight;
    assert.ok(Math.abs(halfLifeWeight - fullWeight / 2) < 1e-6);
  });

  test("score stays within [-1, 1] for mixed extreme ratings", () => {
    const reviews = [
      review({ reviewer: "a", rating: 1 }),
      review({ reviewer: "b", rating: -1 }),
      review({ reviewer: "c", rating: 1 }),
      review({ reviewer: "d", rating: -1 }),
    ];
    const continuity = new Map([
      ["a", established("a")],
      ["b", established("b")],
      ["c", fresh("c")],
      ["d", fresh("d")],
    ]);
    const result = computeReputation(reviews, continuity, { now });
    assert.ok(result.score >= -1 && result.score <= 1);
  });
});
