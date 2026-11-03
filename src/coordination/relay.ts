// Thin wrapper around nostr-tools' SimplePool.
//
// Per spec §4.2: no relay is authoritative. This module treats every relay
// URL as an interchangeable, disposable transport — callers are expected to
// pass in a list of several relays (their own, public ones, whatever) and
// get redundancy for free. There is nothing here that pins the network to
// any specific relay operator.

import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import WS from "ws";

// Node has no built-in WebSocket global on this project's target version;
// nostr-tools needs one injected.
//
// A no-op 'error' listener is attached to every socket here as a
// deliberate crash guard: when a relay is slow or unreachable, nostr-tools
// closes the still-connecting socket, and `ws` then emits an 'error' event
// ("WebSocket was closed before the connection was established"). With no
// listener attached, Node treats an unhandled 'error' event as fatal and
// kills the whole process — meaning one flaky relay could take down an
// agent that was only ever relying on it for redundancy. nostr-tools'
// own onerror/onclose handling (attached separately) still runs normally;
// this only prevents the default "throw if nobody's listening" behavior.
class CrashSafeWebSocket extends WS {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols);
    this.on("error", () => {});
  }
}

useWebSocketImplementation(CrashSafeWebSocket as unknown as typeof globalThis.WebSocket);

/**
 * A handful of well-known public relays, offered purely as a convenient
 * default for getting started. This list is NOT infrastructure the
 * protocol depends on — swap in your own relay(s) freely (spec §4.2, §5).
 */
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  // Reference marketplace relay (deploy/parles.xyz). Replaced
  // relay.nostr.band, which stopped responding in Nov 2026.
  "wss://relay.parles.xyz",
];

let sharedPool: SimplePool | undefined;

/** A process-wide pool is fine for a reference client; nothing here is a singleton by protocol necessity. */
export function getPool(): SimplePool {
  if (!sharedPool) {
    sharedPool = new SimplePool();
  }
  return sharedPool;
}

export function closePool(relays: string[] = DEFAULT_RELAYS): void {
  sharedPool?.close(relays);
  sharedPool = undefined;
}
