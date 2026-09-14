// Identity continuity (spec §4.5): "trust should attach to a persistent
// identity/keypair with continuity, not to a model version," and should
// be "treated as untrusted by default when the identity behind it shows
// no continuity (freshly minted key, no history) — this is expected to be
// the common case at scale, not an edge case."
//
// This module estimates continuity for a pubkey purely from what's
// publicly observable on relays: how long has this key been seen acting,
// and how much. It cannot prove a key is old — only that no older activity
// was found on the relays queried. A key that's actually old but only
// just started using these particular relays looks identical to a
// freshly-minted one here; that's an inherent limit of a permissionless
// system with no registration, not a bug to work around.

import { getPool, DEFAULT_RELAYS } from "../coordination/relay.js";

export interface ContinuityInfo {
  pubkey: string;
  /** Unix seconds of the earliest event found for this pubkey on the queried relays, or null if none found. */
  firstSeen: number | null;
  /** Unix seconds of the most recent event found. */
  lastSeen: number | null;
  eventCount: number;
}

export interface ContinuityOptions {
  relays?: string[];
  /** Cap on how many of the pubkey's events to pull for this estimate. */
  limit?: number;
}

export async function fetchContinuity(
  pubkey: string,
  opts: ContinuityOptions = {},
): Promise<ContinuityInfo> {
  const pool = getPool();
  const relays = opts.relays ?? DEFAULT_RELAYS;
  const events = await pool.querySync(relays, { authors: [pubkey], limit: opts.limit ?? 500 });

  if (events.length === 0) {
    return { pubkey, firstSeen: null, lastSeen: null, eventCount: 0 };
  }
  const timestamps = events.map((e) => e.created_at);
  return {
    pubkey,
    firstSeen: Math.min(...timestamps),
    lastSeen: Math.max(...timestamps),
    eventCount: events.length,
  };
}

/**
 * Turn raw continuity info into a 0..1 score. This specific curve is a
 * reference default, not a protocol requirement — callers building their
 * own trust heuristics are expected to replace it (spec §4.5: trust
 * heuristics are entirely a client-side concern).
 *
 * Shape: a key seen for the first time right now scores 0 (untrusted by
 * default, per spec). Score rises with observed age, saturating at 1
 * around `maturityDays` — deliberately NOT unbounded lifetime accumulation
 * (spec warns against that), just "has this key been around a
 * meaningful while," combined with a mild boost for having been seen more
 * than once (a single ancient-looking event is weak evidence on its own).
 */
export function continuityScore(
  info: ContinuityInfo,
  now: number = Math.floor(Date.now() / 1000),
  maturityDays = 30,
): number {
  if (info.firstSeen === null) return 0;
  const ageDays = Math.max(0, (now - info.firstSeen) / 86400);
  const ageScore = Math.min(1, ageDays / maturityDays);
  const activityScore = Math.min(1, Math.log2(info.eventCount + 1) / Math.log2(20));
  return ageScore * 0.7 + activityScore * 0.3;
}
