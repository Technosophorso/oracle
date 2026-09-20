import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { verifyEvent } from "nostr-tools/pure";
import { createIdentity } from "../identity/keys.js";
import {
  createCoordinationEvent,
  parseCoordinationEvent,
  KIND_COORDINATION,
  PROTOCOL_VERSION,
  type CoordinationAct,
} from "./messages.js";

describe("coordination/messages", () => {
  test("createCoordinationEvent produces a validly-signed event of the right kind", () => {
    const identity = createIdentity();
    const event = createCoordinationEvent(identity, "topic-1", { act: "inform", content: "hi" });
    assert.equal(event.kind, KIND_COORDINATION);
    assert.equal(event.pubkey, identity.publicKeyHex);
    assert.ok(verifyEvent(event));
  });

  test("createCoordinationEvent tags the topic and protocol version", () => {
    const identity = createIdentity();
    const event = createCoordinationEvent(identity, "my-topic", { act: "inform", content: "hi" });
    assert.deepEqual(
      event.tags.find((t) => t[0] === "t"),
      ["t", "my-topic"],
    );
    assert.deepEqual(
      event.tags.find((t) => t[0] === "proto"),
      ["proto", PROTOCOL_VERSION],
    );
  });

  test("createCoordinationEvent adds repeated p tags and NIP-10 e markers", () => {
    const identity = createIdentity();
    const event = createCoordinationEvent(
      identity,
      "t",
      { act: "inform", content: "hi" },
      { to: ["pubkeyA", "pubkeyB"], rootId: "root1", replyToId: "reply1" },
    );
    const pTags = event.tags.filter((t) => t[0] === "p").map((t) => t[1]);
    assert.deepEqual(pTags, ["pubkeyA", "pubkeyB"]);
    assert.deepEqual(
      event.tags.find((t) => t[3] === "root"),
      ["e", "root1", "", "root"],
    );
    assert.deepEqual(
      event.tags.find((t) => t[3] === "reply"),
      ["e", "reply1", "", "reply"],
    );
  });

  const acts: CoordinationAct[] = [
    { act: "task-announce", task: "do the thing" },
    { act: "bid", taskId: "t1", proposal: "I'll do it" },
    { act: "award", taskId: "t1", winner: "somepubkey" },
    { act: "propose", content: "let's do X" },
    { act: "accept", refId: "e1" },
    { act: "reject", refId: "e1", reason: "no thanks" },
    { act: "inform", content: "fyi" },
  ];

  for (const payload of acts) {
    test(`round-trips a "${payload.act}" event through parseCoordinationEvent`, () => {
      const identity = createIdentity();
      const event = createCoordinationEvent(identity, "topic", payload);
      const parsed = parseCoordinationEvent(event);
      assert.ok(parsed);
      assert.equal(parsed.topic, "topic");
      assert.equal(parsed.version, PROTOCOL_VERSION);
      assert.deepEqual(parsed.payload, payload);
    });
  }

  test("parseCoordinationEvent rejects a non-coordination kind", () => {
    const identity = createIdentity();
    const event = createCoordinationEvent(identity, "topic", { act: "inform", content: "hi" });
    assert.equal(parseCoordinationEvent({ ...event, kind: 1 }), undefined);
  });

  test("parseCoordinationEvent rejects malformed JSON content", () => {
    const identity = createIdentity();
    const event = createCoordinationEvent(identity, "topic", { act: "inform", content: "hi" });
    assert.equal(parseCoordinationEvent({ ...event, content: "not json" }), undefined);
  });

  test("parseCoordinationEvent rejects content missing an act field", () => {
    const identity = createIdentity();
    const event = createCoordinationEvent(identity, "topic", { act: "inform", content: "hi" });
    assert.equal(parseCoordinationEvent({ ...event, content: JSON.stringify({ foo: "bar" }) }), undefined);
  });

  test("parseCoordinationEvent rejects a non-object JSON payload", () => {
    const identity = createIdentity();
    const event = createCoordinationEvent(identity, "topic", { act: "inform", content: "hi" });
    assert.equal(parseCoordinationEvent({ ...event, content: JSON.stringify("just a string") }), undefined);
  });
});
