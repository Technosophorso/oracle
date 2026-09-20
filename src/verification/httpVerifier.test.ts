import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createIdentity } from "../identity/keys.js";
import { createListing, type SignedListing } from "../registry/listing.js";
import { verifyHttpListing } from "./httpVerifier.js";

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["bulletPoints"],
  properties: { bulletPoints: { type: "array", items: { type: "string" } } },
};

let server: Server;
let port: number;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/good") {
      res.end(JSON.stringify({ bulletPoints: ["a", "b"] }));
    } else if (req.url === "/bad-schema") {
      res.end(JSON.stringify({ wrongField: true }));
    } else if (req.url === "/not-json") {
      res.end("<not json at all>");
    } else if (req.url === "/slow") {
      setTimeout(() => res.end(JSON.stringify({ bulletPoints: [] })), 2000);
    } else if (req.url === "/big") {
      res.end("x".repeat(2_000_000));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as { port: number }).port;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function listingFor(path: string, extra: Record<string, unknown> = {}): SignedListing {
  const identity = createIdentity();
  return createListing(identity, {
    kind: "tool",
    name: "test-tool",
    description: "test",
    capabilities: ["test"],
    interface: {
      transport: "http",
      spec: { method: "GET", url: `http://localhost:${port}${path}`, responseSchema: RESPONSE_SCHEMA, ...extra },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("verification/httpVerifier", () => {
  test("a schema-conformant response verifies successfully", async () => {
    const result = await verifyHttpListing(listingFor("/good"), { allowPrivateNetwork: true });
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.reachable, true);
      assert.equal(result.statusCode, 200);
      assert.equal(result.schemaValid, true);
    }
  });

  test("a schema-violating response is caught with a specific error", async () => {
    const result = await verifyHttpListing(listingFor("/bad-schema"), { allowPrivateNetwork: true });
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.schemaValid, false);
      assert.ok(result.schemaErrors && result.schemaErrors.length > 0);
    }
  });

  test("a non-JSON response is reported as a schema failure, not a crash", async () => {
    const result = await verifyHttpListing(listingFor("/not-json"), { allowPrivateNetwork: true });
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.schemaValid, false);
      assert.ok(result.schemaErrors?.some((e) => e.includes("not valid JSON")));
    }
  });

  test("a listing with no responseSchema skips schema validation (schemaValid: null)", async () => {
    const identity = createIdentity();
    const listing = createListing(identity, {
      kind: "tool",
      name: "t",
      description: "d",
      capabilities: [],
      interface: { transport: "http", spec: { method: "GET", url: `http://localhost:${port}/good` } },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const result = await verifyHttpListing(listing, { allowPrivateNetwork: true });
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.reachable, true);
      assert.equal(result.schemaValid, null);
    }
  });

  test("a private/loopback address is refused by default", async () => {
    const result = await verifyHttpListing(listingFor("/good"));
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.reachable, false);
      assert.match(result.error ?? "", /localhost/);
    }
  });

  test("allowPrivateNetwork opts back into calling a loopback address", async () => {
    const result = await verifyHttpListing(listingFor("/good"), { allowPrivateNetwork: true });
    assert.equal(result.supported, true);
    if (result.supported) assert.equal(result.reachable, true);
  });

  test("a non-http transport is reported as unsupported, not attempted", async () => {
    const identity = createIdentity();
    const listing = createListing(identity, {
      kind: "tool",
      name: "t",
      description: "d",
      capabilities: [],
      interface: { transport: "mcp", spec: { serverUrl: "https://example.invalid" } },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const result = await verifyHttpListing(listing);
    assert.equal(result.supported, false);
  });

  test("a non-http(s) scheme in the url is refused even with allowPrivateNetwork", async () => {
    const listing = listingFor("/good");
    (listing.interface.spec as { url: string }).url = "file:///etc/passwd";
    const result = await verifyHttpListing(listing, { allowPrivateNetwork: true });
    assert.equal(result.supported, false);
  });

  test("a slow endpoint is aborted at the configured timeout", async () => {
    const result = await verifyHttpListing(listingFor("/slow"), { allowPrivateNetwork: true, timeoutMs: 200 });
    assert.equal(result.supported, true);
    if (result.supported) assert.equal(result.reachable, false);
  });

  test("a response over the size cap is rejected rather than buffered without bound", async () => {
    const result = await verifyHttpListing(listingFor("/big"), { allowPrivateNetwork: true });
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.reachable, false);
      assert.match(result.error ?? "", /byte cap/);
    }
  });
});
