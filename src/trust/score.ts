// Recency-weighted reputation (spec §4.5): "should decay over a short,
// recent window rather than accumulate as a lifetime score, since the
// population of agents is expected to churn continuously." Combines two
// signals per review:
//
//   - Recency: an old review counts for less. Exponential half-life decay
//     rather than a hard cutoff, so there's no cliff where a review that's
//     one day too old suddenly counts for nothing.
//   - Reviewer continuity: a review from a freshly-minted, no-history
//     identity counts for less than one from an identity with observed
//     continuity (spec §4.5's "untrusted by default" for fresh keys) —
//     otherwise a Sybil attacker can mint unlimited reviewer identities
//     for free and dominate a listing's score, which is exactly the
//     "Sybil resistance without a financial layer" problem the spec flags
//     as unsolved (§8) and pushes to client-side mitigation.
//
// This is one reference heuristic among many possible ones — spec §4.5 is
// explicit that trust computation is entirely a client-side choice, never
// something the protocol enforces or publishes an official answer for.

import type { ParsedReview } from "./reviews.js";
import { continuityScore, type ContinuityInfo } from "./continuity.js";

export interface ReputationResult {
  /** Weighted average rating in [-1, 1]. */
  score: number;
  /** Sum of weights actually used — a low value means "not enough reliable signal," not "bad." */
  totalWeight: number;
  reviewCount: number;
}

export interface ScoreOptions {
  now?: number;
  /** Days for a review's recency weight to halve. Short by design (spec §4.5). */
  halfLifeDays?: number;
}

function recencyWeight(review: ParsedReview, now: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, (now - review.createdAt) / 86400);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Compute a recency- and reviewer-continuity-weighted reputation score.
 * `reviewerContinuity` must have one entry per distinct reviewer pubkey
 * present in `reviews` (fetch via continuity.ts) — callers own that
 * lookup since it requires separate relay queries per reviewer.
 */
export function computeReputation(
  reviews: ParsedReview[],
  reviewerContinuity: Map<string, ContinuityInfo>,
  opts: ScoreOptions = {},
): ReputationResult {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const halfLifeDays = opts.halfLifeDays ?? 14;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const review of reviews) {
    const continuity = reviewerContinuity.get(review.reviewer);
    // Unknown reviewer continuity is treated the same as "no continuity
    // found" — the safe default per spec §4.5, not an error.
    const trustOfReviewer = continuity ? continuityScore(continuity, now) : 0;
    // A reviewer with zero observed continuity still contributes a small
    // floor weight rather than exactly zero, so a listing with only
    // fresh-identity reviews isn't indistinguishable from one with none —
    // but that floor is deliberately tiny so mass-minted Sybils can't add
    // up to a large score just by volume.
    const reviewerWeight = 0.05 + trustOfReviewer * 0.95;
    const weight = recencyWeight(review, now, halfLifeDays) * reviewerWeight;
    weightedSum += review.rating * weight;
    totalWeight += weight;
  }

  return {
    score: totalWeight > 0 ? weightedSum / totalWeight : 0,
    totalWeight,
    reviewCount: reviews.length,
  };
}
