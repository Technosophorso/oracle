import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Event } from "nostr-tools/pure";
import { MiniRelay } from "./miniRelay.js";
import { closePool } from "./relay.js";
import { publishText, publishCoordination, subscribeToSubchat } from "./subchat.js";
import { createIdentity } from "../identity/keys.js";

let relay: MiniRelay;
let relays: string[];

before(async () => {
  relay = new MiniRelay(7901);
  await relay.start();
  relays = [relay.url];
});

after(async () => {
  closePool(relays);
  await relay.stop();
});

function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timed out waiting for condition"));
      setTimeout(check, 20);
    };
    check();
  });
}

describe("coordination/subchat", () => {
  test("publishText delivers a plain kind:1 note to a subscriber on the same topic", async () => {
    const identity = createIdentity();
    const topic = `test-topic-${Date.now()}-a`;
    const received: Event[] = [];
    const sub = subscribeToSubchat(topic, (e) => received.push(e), relays);

    await new Promise((r) => setTimeout(r, 100)); // let the subscription register
    await publishText(identity, topic, "hello", relays);
    await waitUntil(() => received.length > 0);

    assert.equal(received[0].kind, 1);
    assert.equal(received[0].content, "hello");
    assert.equal(received[0].pubkey, identity.publicKeyHex);
    sub.close();
  });

  test("publishCoordination delivers a structured event to a subscriber on the same topic", async () => {
    const identity = createIdentity();
    const topic = `test-topic-${Date.now()}-b`;
    const received: Event[] = [];
    const sub = subscribeToSubchat(topic, (e) => received.push(e), relays);

    await new Promise((r) => setTimeout(r, 100));
    await publishCoordination(identity, topic, { act: "inform", content: "fyi" }, {}, relays);
    await waitUntil(() => received.length > 0);

    assert.equal(received[0].kind, 4200);
    sub.close();
  });

  test("a subscriber on a different topic does not receive the message", async () => {
    const identity = createIdentity();
    const topicA = `test-topic-${Date.now()}-c1`;
    const topicB = `test-topic-${Date.now()}-c2`;
    const received: Event[] = [];
    const sub = subscribeToSubchat(topicB, (e) => received.push(e), relays);

    await new Promise((r) => setTimeout(r, 100));
    await publishText(identity, topicA, "not for you", relays);
    await new Promise((r) => setTimeout(r, 300)); // give it a chance to (wrongly) arrive

    assert.equal(received.length, 0);
    sub.close();
  });

  test("after close(), no further events are delivered to that subscription", async () => {
    const identity = createIdentity();
    const topic = `test-topic-${Date.now()}-d`;
    const received: Event[] = [];
    const sub = subscribeToSubchat(topic, (e) => received.push(e), relays);
    await new Promise((r) => setTimeout(r, 100));

    await publishText(identity, topic, "first", relays);
    await waitUntil(() => received.length === 1);
    sub.close();

    await publishText(identity, topic, "second", relays);
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(received.length, 1);
  });
});
