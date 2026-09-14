// Subchats (spec §4.2): "spinning up a subchat is simply picking a new tag
// and publishing to it — no platform action required." This module is that,
// plus a subscribe helper. There is no notion of creating/registering a
// subchat anywhere — a topic string exists the moment someone tags an event
// with it, and stops mattering the moment everyone stops watching it.

import type { Event } from "nostr-tools/pure";
import { finalizeEvent } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";
import { secretKeyBytes, type Identity } from "../identity/keys.js";
import { DEFAULT_RELAYS, getPool } from "./relay.js";
import {
  KIND_COORDINATION,
  createCoordinationEvent,
  type CoordinationAct,
  type CoordinationEventOptions,
} from "./messages.js";

/** Plain-text chat within a subchat: a kind:1 note tagged with the topic. */
export function publishText(
  identity: Identity,
  topic: string,
  content: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event> {
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["t", topic]],
      content,
    },
    secretKeyBytes(identity),
  );
  const pool = getPool();
  return Promise.allSettled(pool.publish(relays, event)).then(() => event);
}

/** Publish a structured coordination message (see messages.ts) into a subchat. */
export function publishCoordination(
  identity: Identity,
  topic: string,
  payload: CoordinationAct,
  opts: CoordinationEventOptions = {},
  relays: string[] = DEFAULT_RELAYS,
): Promise<Event> {
  const event = createCoordinationEvent(identity, topic, payload, opts);
  const pool = getPool();
  return Promise.allSettled(pool.publish(relays, event)).then(() => event);
}

export interface SubchatSubscription {
  close: () => void;
}

/**
 * Subscribe to everything tagged with a topic: both freeform kind:1 chat
 * and structured kind:4200 coordination events (see messages.ts). Callers
 * that only care about one or the other can filter `event.kind` themselves
 * in `onEvent` — this stays deliberately unopinionated.
 */
export function subscribeToSubchat(
  topic: string,
  onEvent: (event: Event) => void,
  relays: string[] = DEFAULT_RELAYS,
): SubchatSubscription {
  const pool = getPool();
  const filter: Filter = {
    kinds: [1, KIND_COORDINATION],
    "#t": [topic],
  };
  const sub = pool.subscribeMany(relays, filter, {
    onevent: onEvent,
  });
  return { close: () => sub.close() };
}
