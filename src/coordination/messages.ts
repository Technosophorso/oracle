// Structured coordination vocabulary (spec §4.2, Phase 4 pulled forward
// because it costs nothing to define alongside the raw subchat transport).
//
// This is deliberately a thin layer on top of plain Nostr events, not a
// replacement for free text: an agent can always just publish kind:1 notes
// tagged with a topic (see subchat.ts). Structured acts exist for agents
// that want machine-parseable negotiation instead of parsing prose.
//
// Vocabulary is a small merge of Contract-Net (task-announce / bid / award)
// and FIPA-ACL-style speech acts (propose / accept / reject / inform),
// exactly as suggested in the spec. Full schema is documented in
// docs/PROTOCOL.md — keep that file in sync with this one.

import { finalizeEvent, type Event, type EventTemplate } from "nostr-tools/pure";
import { secretKeyBytes, type Identity } from "../identity/keys.js";

/** Custom regular event kind for structured coordination messages. See docs/PROTOCOL.md. */
export const KIND_COORDINATION = 4200;

/** Version tag carried on every coordination event, so parsers can reject payloads from incompatible future versions. */
export const PROTOCOL_VERSION = "oracle-coord/1";

export type CoordinationAct =
  | {
      act: "task-announce";
      /** Free-text description of the task/capability being requested. */
      task: string;
      /** Optional ISO-8601 deadline for bids. */
      deadline?: string;
    }
  | {
      act: "bid";
      /** Event id of the task-announce this bid responds to. */
      taskId: string;
      proposal: string;
    }
  | {
      act: "award";
      /** Event id of the task-announce being resolved. */
      taskId: string;
      /** Public key of the winning bidder. */
      winner: string;
    }
  | {
      act: "propose";
      content: string;
    }
  | {
      act: "accept";
      /** Event id of the propose/bid being accepted. */
      refId: string;
    }
  | {
      act: "reject";
      /** Event id of the propose/bid being rejected. */
      refId: string;
      reason?: string;
    }
  | {
      act: "inform";
      content: string;
    };

export interface CoordinationEventOptions {
  /** Recipient pubkey(s), if this message is addressed rather than broadcast to the subchat. */
  to?: string[];
  /** Thread root event id (NIP-10 "root" marker), for grouping replies. */
  rootId?: string;
  /** Direct parent event id (NIP-10 "reply" marker), if replying to a specific message. */
  replyToId?: string;
}

function buildTags(
  topic: string,
  opts: CoordinationEventOptions,
): string[][] {
  const tags: string[][] = [
    ["t", topic],
    ["proto", PROTOCOL_VERSION],
  ];
  for (const pubkey of opts.to ?? []) {
    tags.push(["p", pubkey]);
  }
  if (opts.rootId) {
    tags.push(["e", opts.rootId, "", "root"]);
  }
  if (opts.replyToId) {
    tags.push(["e", opts.replyToId, "", "reply"]);
  }
  return tags;
}

/** Build and sign a structured coordination event, ready to publish. */
export function createCoordinationEvent(
  identity: Identity,
  topic: string,
  payload: CoordinationAct,
  opts: CoordinationEventOptions = {},
): Event {
  const template: EventTemplate = {
    kind: KIND_COORDINATION,
    created_at: Math.floor(Date.now() / 1000),
    tags: buildTags(topic, opts),
    content: JSON.stringify(payload),
  };
  return finalizeEvent(template, secretKeyBytes(identity));
}

export interface ParsedCoordinationEvent {
  topic: string | undefined;
  version: string | undefined;
  payload: CoordinationAct;
  raw: Event;
}

/**
 * Parse an incoming event as a coordination message. Returns undefined if
 * it isn't one of ours (wrong kind, malformed JSON, or missing act field) —
 * per spec §3, the protocol never assumes well-formed input from strangers.
 */
export function parseCoordinationEvent(
  event: Event,
): ParsedCoordinationEvent | undefined {
  if (event.kind !== KIND_COORDINATION) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(event.content);
  } catch {
    return undefined;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { act?: unknown }).act !== "string"
  ) {
    return undefined;
  }
  const topic = event.tags.find((t) => t[0] === "t")?.[1];
  const version = event.tags.find((t) => t[0] === "proto")?.[1];
  return { topic, version, payload: payload as CoordinationAct, raw: event };
}
