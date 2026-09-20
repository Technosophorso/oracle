import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { continuityScore, type ContinuityInfo } from "./continuity.js";

const now = 1_800_000_000; // fixed reference point, irrelevant which real date

function info(overrides: Partial<ContinuityInfo>): ContinuityInfo {
  return { pubkey: "pub", firstSeen: null, lastSeen: null, eventCount: 0, ...overrides };
}

describe("trust/continuity continuityScore", () => {
  test("a pubkey with no observed history scores 0 (untrusted by default)", () => {
    assert.equal(continuityScore(info({ firstSeen: null }), now), 0);
  });

  test("a pubkey first seen right now with no other events scores 0", () => {
    const score = continuityScore(info({ firstSeen: now, eventCount: 0 }), now);
    assert.equal(score, 0);
  });

  test("event count alone (zero elapsed age) contributes at most its 0.3 weight, never as much as genuine age", () => {
    // This is a real, documented limitation (see docs/TRUST.md): the activity
    // term is independent of *when* those events happened, so a burst of
    // events at the moment a key is minted still yields a nonzero score.
    // It's bounded well below what age contributes, not eliminated.
    const burstAtBirth = continuityScore(info({ firstSeen: now, eventCount: 1000 }), now);
    assert.ok(burstAtBirth > 0 && burstAtBirth <= 0.3);

    const genuineAge = continuityScore(info({ firstSeen: now - 30 * 86400, eventCount: 1000 }), now);
    assert.ok(genuineAge > burstAtBirth);
  });

  test("score increases with observed age", () => {
    const young = continuityScore(info({ firstSeen: now - 1 * 86400, eventCount: 1 }), now);
    const old = continuityScore(info({ firstSeen: now - 20 * 86400, eventCount: 1 }), now);
    assert.ok(old > young);
  });

  test("score saturates at the maturity ceiling rather than growing unbounded", () => {
    const atMaturity = continuityScore(info({ firstSeen: now - 30 * 86400, eventCount: 1 }), now, 30);
    const wayPastMaturity = continuityScore(info({ firstSeen: now - 3000 * 86400, eventCount: 1 }), now, 30);
    assert.ok(Math.abs(atMaturity - wayPastMaturity) < 1e-9);
  });

  test("more observed events increases score at the same age", () => {
    const fewEvents = continuityScore(info({ firstSeen: now - 10 * 86400, eventCount: 1 }), now);
    const manyEvents = continuityScore(info({ firstSeen: now - 10 * 86400, eventCount: 50 }), now);
    assert.ok(manyEvents > fewEvents);
  });

  test("score is always within [0, 1]", () => {
    const cases = [
      info({ firstSeen: now - 100000 * 86400, eventCount: 100000 }),
      info({ firstSeen: now, eventCount: 0 }),
      info({ firstSeen: now - 5 * 86400, eventCount: 3 }),
    ];
    for (const c of cases) {
      const score = continuityScore(c, now);
      assert.ok(score >= 0 && score <= 1, `score ${score} out of range for ${JSON.stringify(c)}`);
    }
  });
});
