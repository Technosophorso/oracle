// Reviews (spec §4.3): "cheap, ephemeral Nostr events referencing the
// listing's Arweave transaction id." Reviews are never written to
// Arweave — only the listing itself needs to be eternal. This is the
// missing piece the rest of Phase 5's trust tooling is computed over:
// nothing here is authoritative, it's just a signed opinion an agent can
// choose to weigh however it likes (spec §4.5).

import { finalizeEvent, type Event } from "nostr-tools/pure";
import { secretKeyBytes, type Identity } from "../identity/keys.js";
import { DEFAULT_RELAYS, getPool } from "../coordination/relay.js";

export const KIND_REVIEW = 4201;
export const REVIEW_PROTOCOL_VERSION = "oracle-review/1";

/**
 * Reviews reference their target with a NIP-73 external content id
 * (`["i", "arweave:tx:<txid>"]` + `["k", "arweave:tx"]`), following NIP-73's
 * blockchain-transaction form. It has to be a single-letter tag: NIP-01
 * relays only index those, so a filter on anything longer (an earlier
 * draft used `["listing", ...]`) is rejected by real relays like strfry.
 * Arweave tx ids are base64url, so unlike hex chains they stay case-sensitive.
 */
export const LISTING_ID_KIND = "arweave:tx";
const LISTING_ID_PREFIX = `${LISTING_ID_KIND}:`;

export function listingExternalId(listingTxId: string): string {
  return LISTING_ID_PREFIX + listingTxId;
}

export interface ReviewPayload {
  /** -1 (bad), 0 (neutral/mixed), or +1 (good). Deliberately coarse — spec §4.5 warns against treating this as a precise lifetime score. */
  rating: -1 | 0 | 1;
  comment?: string;
}

/** Publish a review of a listing, referencing its Arweave transaction id. */
export function publishReview(
  identity: Identity,
  listingTxId: string,
  payload: ReviewPayload,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event> {
  const event = finalizeEvent(
    {
      kind: KIND_REVIEW,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["i", listingExternalId(listingTxId)],
        ["k", LISTING_ID_KIND],
        ["proto", REVIEW_PROTOCOL_VERSION],
      ],
      content: JSON.stringify(payload),
    },
    secretKeyBytes(identity),
  );
  const pool = getPool();
  return Promise.allSettled(pool.publish(relays, event)).then(() => event);
}

export interface ParsedReview {
  reviewer: string;
  listingTxId: string;
  rating: -1 | 0 | 1;
  comment?: string;
  createdAt: number;
  raw: Event;
}

function parseReview(event: Event): ParsedReview | undefined {
  if (event.kind !== KIND_REVIEW) return undefined;
  if (event.tags.find((t) => t[0] === "proto")?.[1] !== REVIEW_PROTOCOL_VERSION) return undefined;
  const externalId = event.tags.find((t) => t[0] === "i" && t[1]?.startsWith(LISTING_ID_PREFIX))?.[1];
  const listingTxId = externalId?.slice(LISTING_ID_PREFIX.length);
  if (!listingTxId) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(event.content);
  } catch {
    return undefined;
  }
  const rating = (payload as { rating?: unknown }).rating;
  if (rating !== -1 && rating !== 0 && rating !== 1) return undefined;
  const comment = (payload as { comment?: unknown }).comment;
  return {
    reviewer: event.pubkey,
    listingTxId,
    rating,
    comment: typeof comment === "string" ? comment : undefined,
    createdAt: event.created_at,
    raw: event,
  };
}

/** Fetch all reviews currently held by the given relays for one listing. Relays are NOT required to retain reviews forever — they're cheap, non-permanent opinions, not registry records (spec §4.3). */
export async function fetchReviews(
  listingTxId: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<ParsedReview[]> {
  const pool = getPool();
  const events = await pool.querySync(relays, { kinds: [KIND_REVIEW], "#i": [listingExternalId(listingTxId)] });
  const parsed: ParsedReview[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) continue; // the same event can arrive from several relays
    seen.add(event.id);
    const review = parseReview(event);
    if (review) parsed.push(review);
  }
  return parsed;
}
