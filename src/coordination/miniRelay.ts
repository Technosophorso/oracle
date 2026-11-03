// A minimal, in-memory Nostr relay (NIP-01 subset: EVENT/REQ/CLOSE/EOSE).
//
// This exists for two reasons at once:
//   1. It's a concrete answer to spec §4.2's "document clearly how to run
//      an independent relay from day one" — anyone can run a relay, and
//      here is the simplest possible one that actually works.
//   2. It lets this repo's examples (trust-demo.ts) run deterministically
//      and instantly instead of depending on public relay rate limits,
//      timestamp policies, or network flakiness — the same reason
//      registry/discovery demos use arlocal instead of Arweave mainnet.
//
// NOT production-grade: no persistence, no auth, no rate limiting, no
// spam defenses, everything lost on restart. Real relay operators want
// something like strfry or nostream. This is a teaching/testing relay.

import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { Event } from "nostr-tools/pure";
import { matchFilter, type Filter } from "nostr-tools/filter";
import { buildRelayInfo, type RelayInfoOptions } from "./relayInfo.js";

interface Subscription {
  id: string;
  filters: Filter[];
  socket: WebSocket;
}

export class MiniRelay {
  private httpServer: Server | undefined;
  private wss: WebSocketServer | undefined;
  private events: Event[] = [];
  private subscriptions: Subscription[] = [];

  constructor(
    private port: number,
    private relayInfo: RelayInfoOptions = { name: "mini-relay", description: "local test relay" },
  ) {}

  /**
   * Serves the NIP-11 relay information document over plain HTTP GET at
   * the same URL/port used for the WebSocket connection — this is what
   * lets a generic Nostr client discover "this relay carries the
   * marketplace's event kinds" without prior knowledge (see relayInfo.ts).
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer = createServer((req, res) => {
        const accept = req.headers.accept ?? "";
        if (accept.includes("application/nostr+json")) {
          res.setHeader("Content-Type", "application/nostr+json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(JSON.stringify(buildRelayInfo(this.relayInfo)));
        } else {
          res.statusCode = 200;
          res.end("mini nostr relay — GET with Accept: application/nostr+json for relay info, or connect via WebSocket");
        }
      });
      this.wss = new WebSocketServer({ server: this.httpServer });
      this.wss.on("connection", (socket) => this.handleConnection(socket));
      this.httpServer.listen(this.port, resolve);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.subscriptions = [];
      if (!this.httpServer) return resolve();
      this.wss?.close();
      this.httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  get url(): string {
    return `ws://localhost:${this.port}`;
  }

  /** Same host:port as `url`, for fetching the NIP-11 info document over HTTP instead of connecting via WebSocket. */
  get infoUrl(): string {
    return `http://localhost:${this.port}`;
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!Array.isArray(msg) || typeof msg[0] !== "string") return;

      const [type] = msg;
      if (type === "EVENT") this.handleEvent(socket, msg[1] as Event);
      else if (type === "REQ") this.handleReq(socket, msg[1] as string, msg.slice(2) as Filter[]);
      else if (type === "CLOSE") this.handleClose(msg[1] as string);
    });

    socket.on("close", () => {
      this.subscriptions = this.subscriptions.filter((s) => s.socket !== socket);
    });
  }

  private handleEvent(socket: WebSocket, event: Event): void {
    this.events.push(event);
    socket.send(JSON.stringify(["OK", event.id, true, ""]));
    for (const sub of this.subscriptions) {
      if (sub.filters.some((f) => matchFilter(f, event))) {
        sub.socket.send(JSON.stringify(["EVENT", sub.id, event]));
      }
    }
  }

  private handleReq(socket: WebSocket, subId: string, filters: Filter[]): void {
    // NIP-01: only single-letter tags are indexed. Real relays (e.g. strfry)
    // reject a filter on any other tag, so this test relay does too —
    // otherwise code that only works here would pass its tests.
    const unindexed = filters
      .flatMap((f) => Object.keys(f))
      .find((key) => key.startsWith("#") && !/^#[a-zA-Z]$/.test(key));
    if (unindexed) {
      socket.send(JSON.stringify(["CLOSED", subId, `error: unindexed tag filter ${unindexed}`]));
      return;
    }
    for (const event of this.events) {
      if (filters.some((f) => matchFilter(f, event))) {
        socket.send(JSON.stringify(["EVENT", subId, event]));
      }
    }
    socket.send(JSON.stringify(["EOSE", subId]));
    this.subscriptions.push({ id: subId, filters, socket });
  }

  private handleClose(subId: string): void {
    this.subscriptions = this.subscriptions.filter((s) => s.id !== subId);
  }
}
