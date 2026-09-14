// End-to-end demo of Phase 5's automated tool verification: a tiny local
// HTTP "tool" is checked against its own declared response schema, once
// when it's honest and once when it's broken — proving the verifier
// actually catches a spec violation rather than just checking reachability.
// It also proves the SSRF guard is on by default: the exact same local
// endpoint is refused unless the caller explicitly opts out of the
// private-network guard (see httpVerifier.ts's allowPrivateNetwork option).
//
// Run with: npm run demo:verification

import { createServer } from "node:http";
import { createIdentity } from "../src/identity/keys.js";
import { createListing } from "../src/registry/listing.js";
import { verifyHttpListing } from "../src/verification/httpVerifier.js";

const PORT = 8765;

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["bulletPoints"],
  properties: {
    bulletPoints: { type: "array", items: { type: "string" }, minItems: 1 },
  },
};

function startFixtureServer() {
  return createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/good") {
      res.end(JSON.stringify({ bulletPoints: ["First point", "Second point"] }));
    } else if (req.url === "/bad") {
      // Violates the schema: missing bulletPoints entirely.
      res.end(JSON.stringify({ summary: "not the field the schema requires" }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  }).listen(PORT);
}

async function main() {
  const server = startFixtureServer();
  console.log(`Fixture tool server running at http://localhost:${PORT}\n`);

  try {
    const publisher = createIdentity();

    const goodListing = createListing(publisher, {
      kind: "tool",
      name: "honest-summarizer",
      description: "Returns bullet points as promised.",
      capabilities: ["summarization"],
      interface: { transport: "http", spec: { method: "GET", url: `http://localhost:${PORT}/good`, responseSchema: RESPONSE_SCHEMA } },
      createdAt: new Date().toISOString(),
    });
    const badListing = createListing(publisher, {
      kind: "tool",
      name: "dishonest-summarizer",
      description: "Claims the same interface but doesn't actually deliver it.",
      capabilities: ["summarization"],
      interface: { transport: "http", spec: { method: "GET", url: `http://localhost:${PORT}/bad`, responseSchema: RESPONSE_SCHEMA } },
      createdAt: new Date().toISOString(),
    });

    console.log("--- Verifying the honest tool (allowPrivateNetwork: true, since this is our own local fixture) ---");
    const goodResult = await verifyHttpListing(goodListing, { allowPrivateNetwork: true });
    console.log(JSON.stringify(goodResult, null, 2));

    console.log("\n--- Verifying the dishonest tool (same schema, different actual response) ---");
    const badResult = await verifyHttpListing(badListing, { allowPrivateNetwork: true });
    console.log(JSON.stringify(badResult, null, 2));

    console.log("\n--- Verifying the SAME honest tool WITHOUT allowPrivateNetwork (default behavior) ---");
    const guardedResult = await verifyHttpListing(goodListing);
    console.log(JSON.stringify(guardedResult, null, 2));
    console.log(
      "\nDefault SSRF guard blocked a loopback address even for a legitimate listing — that's intentional:",
    );
    console.log("verifying arbitrary third-party listings should never touch private network space by default.");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
