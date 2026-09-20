import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildRelayInfo } from "./relayInfo.js";

describe("coordination/relayInfo", () => {
  test("buildRelayInfo defaults supported_nips to [1]", () => {
    const doc = buildRelayInfo({ name: "n", description: "d" });
    assert.deepEqual(doc.supported_nips, [1]);
  });

  test("buildRelayInfo advertises the marketplace's fixed event kinds", () => {
    const doc = buildRelayInfo({ name: "n", description: "d" });
    assert.deepEqual(doc.oracle_marketplace.event_kinds, { coordination: 4200, review: 4201 });
  });

  test("buildRelayInfo passes through known relays and sample listing ids", () => {
    const doc = buildRelayInfo({
      name: "n",
      description: "d",
      knownRelays: ["wss://a.example"],
      sampleListingTxIds: ["tx1", "tx2"],
    });
    assert.deepEqual(doc.oracle_marketplace.known_relays, ["wss://a.example"]);
    assert.deepEqual(doc.oracle_marketplace.sample_listing_tx_ids, ["tx1", "tx2"]);
  });

  test("buildRelayInfo defaults known relays and sample ids to empty arrays", () => {
    const doc = buildRelayInfo({ name: "n", description: "d" });
    assert.deepEqual(doc.oracle_marketplace.known_relays, []);
    assert.deepEqual(doc.oracle_marketplace.sample_listing_tx_ids, []);
  });

  test("buildRelayInfo includes pointers to every protocol doc", () => {
    const doc = buildRelayInfo({ name: "n", description: "d" });
    for (const key of ["nip", "protocol", "registry", "discovery", "trust", "verification"]) {
      assert.ok((doc.oracle_marketplace.docs as Record<string, string>)[key], `missing docs.${key}`);
    }
  });

  test("buildRelayInfo is JSON-serializable", () => {
    const doc = buildRelayInfo({ name: "n", description: "d", pubkey: "abc", contact: "me@example.com" });
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(doc)));
  });
});
