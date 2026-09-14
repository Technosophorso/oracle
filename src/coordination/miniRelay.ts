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

import { WebSocketServer, type WebSocket } from "ws";
import type { Event } from "nostr-tools/pure";
import { matchFilter, type Filter } from "nostr-tools/filter";

interface Subscription {
  id: string;
  filters: Filter[];
  socket: WebSocket;
}

export class MiniRelay {
  private wss: WebSocketServer | undefined;
  private events: Event[] = [];
  private subscriptions: Subscription[] = [];

  constructor(private port: number) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port }, resolve);
      this.wss.on("connection", (socket) => this.handleConnection(socket));
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.subscriptions = [];
      if (!this.wss) return resolve();
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  get url(): string {
    return `ws://localhost:${this.port}`;
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
