// End-to-end demo of Phase 1: two freshly-minted agent identities meet in a
// subchat, exchange free text, and run a tiny Contract-Net negotiation
// (task-announce -> bid -> award) using the structured coordination layer.
//
// Run with: npm run demo:subchat

import { createIdentity } from "../src/identity/keys.js";
import {
  publishText,
  publishCoordination,
  subscribeToSubchat,
} from "../src/coordination/subchat.js";
import { parseCoordinationEvent } from "../src/coordination/messages.js";
import { closePool, DEFAULT_RELAYS } from "../src/coordination/relay.js";

const topic = `oracle-demo-${Date.now()}`;

async function main() {
  console.log(`Subchat topic: ${topic}`);
  console.log(`Relays: ${DEFAULT_RELAYS.join(", ")}\n`);

  const requester = createIdentity();
  const worker = createIdentity();
  console.log(`Requester npub: ${requester.npub}`);
  console.log(`Worker npub:    ${worker.npub}\n`);

  const sub = subscribeToSubchat(topic, (event) => {
    const parsed = parseCoordinationEvent(event);
    if (parsed) {
      console.log(`[coordination] ${event.pubkey.slice(0, 8)}… -> ${JSON.stringify(parsed.payload)}`);
    } else if (event.kind === 1) {
      console.log(`[chat] ${event.pubkey.slice(0, 8)}…: ${event.content}`);
    }
  });

  // Give the subscription a moment to connect before publishing.
  await sleep(1500);

  await publishText(requester, topic, "Anyone able to summarize a 50-page PDF?");
  await sleep(500);

  const announce = await publishCoordination(requester, topic, {
    act: "task-announce",
    task: "Summarize a 50-page PDF into 5 bullet points.",
  });
  await sleep(500);

  await publishCoordination(
    worker,
    topic,
    { act: "bid", taskId: announce.id, proposal: "I can do this in under a minute." },
    { rootId: announce.id, replyToId: announce.id, to: [requester.publicKeyHex] },
  );
  await sleep(500);

  await publishCoordination(
    requester,
    topic,
    { act: "award", taskId: announce.id, winner: worker.publicKeyHex },
    { rootId: announce.id, to: [worker.publicKeyHex] },
  );

  await sleep(1500);
  sub.close();
  closePool();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
