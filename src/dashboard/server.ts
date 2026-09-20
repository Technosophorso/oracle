#!/usr/bin/env tsx
// Local dashboard: a small HTTP server (plain node:http, no framework —
// consistent with miniRelay.ts's approach) serving a static front-end
// plus a JSON API over the same identity/registry/coordination/trust
// modules the MCP server uses.
//
// SECURITY: binds to 127.0.0.1 only, never 0.0.0.0. This server can send
// messages, publish permanent listings, and spend from a local wallet
// using your identity with no auth of its own — it is a personal, local
// tool, not something to expose to a network. See docs/DASHBOARD.md.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "./api.js";
import { CONFIG } from "../mcp/config.js";
import { closePool } from "../coordination/relay.js";

const PORT = Number(process.env.ORACLE_DASHBOARD_PORT ?? 4390);
const PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

async function serveStatic(pathname: string, res: import("node:http").ServerResponse): Promise<void> {
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  // Prevent path traversal outside the public directory.
  const safePath = join(PUBLIC_DIR, relativePath.replace(/\.\./g, ""));
  try {
    const data = await readFile(safePath);
    const contentType = CONTENT_TYPES[extname(safePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (!url.pathname.startsWith("/api/")) {
    return serveStatic(url.pathname, res);
  }

  try {
    const { pathname, searchParams } = url;

    if (pathname === "/api/identity" && req.method === "GET") {
      return sendJson(res, 200, api.getIdentityInfo());
    }

    if (pathname === "/api/coordination/topics" && req.method === "GET") {
      const sinceMinutes = Number(searchParams.get("sinceMinutes") ?? 1440);
      const limit = Number(searchParams.get("limit") ?? 500);
      return sendJson(res, 200, await api.listRecentTopics(sinceMinutes, limit));
    }

    if (pathname === "/api/coordination/subchat" && req.method === "GET") {
      const topic = searchParams.get("topic");
      if (!topic) throw new api.ApiError("topic query param is required");
      const sinceMinutes = Number(searchParams.get("sinceMinutes") ?? 1440);
      const limit = Number(searchParams.get("limit") ?? 200);
      return sendJson(res, 200, await api.readSubchat(topic, sinceMinutes, limit));
    }

    if (pathname === "/api/coordination/subchat" && req.method === "POST") {
      const body = (await readJsonBody(req)) as { topic?: string; content?: string };
      if (!body.topic || !body.content) throw new api.ApiError("topic and content are required");
      return sendJson(res, 200, await api.sendText(body.topic, body.content));
    }

    if (pathname === "/api/coordination/act" && req.method === "POST") {
      const body = (await readJsonBody(req)) as { topic?: string; message?: import("../coordination/messages.js").CoordinationAct; to?: string[] };
      if (!body.topic || !body.message) throw new api.ApiError("topic and message are required");
      return sendJson(res, 200, await api.sendAct(body.topic, body.message, body.to));
    }

    if (pathname === "/api/registry/search" && req.method === "GET") {
      const query = searchParams.get("query") ?? "";
      const kind = (searchParams.get("kind") as "tool" | "agent" | null) ?? undefined;
      const capability = searchParams.get("capability") ?? undefined;
      const limit = Number(searchParams.get("limit") ?? 50);
      return sendJson(res, 200, api.registrySearch(query, kind ?? undefined, capability, limit));
    }

    if (pathname === "/api/registry/build-index" && req.method === "POST") {
      const body = (await readJsonBody(req)) as { gateway?: string; rebuild?: boolean };
      return sendJson(res, 200, await api.buildIndex(body.gateway, Boolean(body.rebuild)));
    }

    if (pathname.startsWith("/api/registry/listing/") && req.method === "GET") {
      const txId = decodeURIComponent(pathname.slice("/api/registry/listing/".length));
      return sendJson(res, 200, await api.getListing(txId, searchParams.get("gateway") ?? undefined));
    }

    if (pathname === "/api/registry/publish" && req.method === "POST") {
      const body = (await readJsonBody(req)) as api.PublishListingInput;
      if (!body.kind || !body.name || !body.description || !body.capabilities || !body.interfaceTransport) {
        throw new api.ApiError("kind, name, description, capabilities, interfaceTransport are required");
      }
      return sendJson(res, 200, await api.publishNewListing(body));
    }

    if (pathname.startsWith("/api/trust/score/") && req.method === "GET") {
      const txId = decodeURIComponent(pathname.slice("/api/trust/score/".length));
      const halfLifeDays = searchParams.get("halfLifeDays") ? Number(searchParams.get("halfLifeDays")) : undefined;
      return sendJson(res, 200, await api.getTrustScore(txId, halfLifeDays));
    }

    if (pathname === "/api/trust/review" && req.method === "POST") {
      const body = (await readJsonBody(req)) as { listingTxId?: string; rating?: -1 | 0 | 1; comment?: string };
      if (!body.listingTxId || body.rating === undefined) throw new api.ApiError("listingTxId and rating are required");
      return sendJson(res, 200, await api.submitReview(body.listingTxId, body.rating, body.comment));
    }

    if (pathname.startsWith("/api/verification/check/") && req.method === "GET") {
      const txId = decodeURIComponent(pathname.slice("/api/verification/check/".length));
      const timeoutMs = searchParams.get("timeoutMs") ? Number(searchParams.get("timeoutMs")) : undefined;
      const allowPrivateNetwork = searchParams.get("allowPrivateNetwork") === "true";
      return sendJson(res, 200, await api.checkTool(txId, searchParams.get("gateway") ?? undefined, timeoutMs, allowPrivateNetwork));
    }

    return sendJson(res, 404, { error: "Unknown API route" });
  } catch (err) {
    const status = err instanceof api.ApiError ? err.status : 500;
    return sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`the-oracle dashboard running at http://127.0.0.1:${PORT}`);
  console.log(`identity: ${CONFIG.identityFile}`);
  console.log(`gateway: ${CONFIG.gateway}`);
  console.log(`relays: ${CONFIG.relays.join(", ")}`);
});

process.on("SIGINT", () => {
  closePool(CONFIG.relays);
  server.close();
  process.exit(0);
});
