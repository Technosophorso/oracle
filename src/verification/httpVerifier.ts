// Automated tool verification (spec §4.5 / Phase 5): "a tool listing's
// claims can often be tested automatically (sandboxed call, compare
// output to spec) rather than trusted socially." This checks an
// `interface.transport: "http"` listing (see REGISTRY.md §3) by actually
// calling it and validating the response against its declared schema.
//
// SECURITY NOTE — this function calls a URL supplied by an untrusted,
// permissionless listing (spec §3: no gatekeeping on what gets listed).
// That's an inherent SSRF risk: a malicious listing could point `url` at
// internal infrastructure to probe a caller's private network. This
// module applies best-effort mitigations (private/loopback IP blocking,
// scheme allowlisting, timeouts, response size caps) but these are NOT a
// substitute for running verification in an actually network-isolated
// sandbox (container/VM with egress restricted to the public internet) —
// that's the real fix for production use and is out of scope for this
// reference script. Treat "sandboxed" in this module's name as aspirational
// documentation of intent, not a guarantee.

import { lookup } from "node:dns/promises";
import { createRequire } from "node:module";
import type { SignedListing } from "../registry/listing.js";

// ajv's CJS typings don't interop cleanly with a plain `import Ajv from
// "ajv"` under this project's NodeNext module resolution (same issue as
// arlocal in examples/registry-demo.ts) — loaded via require instead.
const require = createRequire(import.meta.url);
interface AjvValidateFunction {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }> | null;
}
interface AjvInstance {
  compile(schema: object): AjvValidateFunction;
}
const Ajv: new (opts?: { strict?: boolean }) => AjvInstance = require("ajv");

const MAX_RESPONSE_BYTES = 1_000_000;
const ajv = new Ajv({ strict: false });

export interface HttpVerificationResult {
  supported: true;
  reachable: boolean;
  statusCode?: number;
  latencyMs: number;
  /** null when the listing declared no responseSchema to check against. */
  schemaValid: boolean | null;
  schemaErrors?: string[];
  error?: string;
}

export interface UnsupportedVerificationResult {
  supported: false;
  reason: string;
}

export interface HttpVerifierOptions {
  timeoutMs?: number;
  /** Only used for a request with method other than GET/HEAD/DELETE. */
  sampleRequestBody?: unknown;
  /**
   * Skip the private/loopback address guard. Default false — leave it
   * false unless you specifically intend to verify a tool on your own
   * private network and understand you're disabling SSRF protection for
   * this call. Never set this true when verifying arbitrary listings from
   * the public registry.
   */
  allowPrivateNetwork?: boolean;
}

const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [ipToInt("0.0.0.0"), ipToInt("0.255.255.255")],
  [ipToInt("10.0.0.0"), ipToInt("10.255.255.255")],
  [ipToInt("100.64.0.0"), ipToInt("100.127.255.255")], // CGNAT
  [ipToInt("127.0.0.0"), ipToInt("127.255.255.255")],
  [ipToInt("169.254.0.0"), ipToInt("169.254.255.255")], // link-local / cloud metadata
  [ipToInt("172.16.0.0"), ipToInt("172.31.255.255")],
  [ipToInt("192.168.0.0"), ipToInt("192.168.255.255")],
];

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const value = ipToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([min, max]) => value >= min && value <= max);
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname === "localhost") throw new Error("refusing to call localhost");
  const { address, family } = await lookup(hostname);
  const isPrivate = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
  if (isPrivate) {
    throw new Error(`refusing to call private/loopback address ${address} (resolved from ${hostname})`);
  }
}

export type VerificationResult = HttpVerificationResult | UnsupportedVerificationResult;

/** Named distinctly from registry/listing.ts's verifyListing (signature check) — this checks the tool's actual behavior, not the listing's authenticity. Run both; they check different things. */
export async function verifyHttpListing(
  listing: SignedListing,
  opts: HttpVerifierOptions = {},
): Promise<VerificationResult> {
  if (listing.interface.transport !== "http") {
    return {
      supported: false,
      reason: `automated verification of transport "${listing.interface.transport}" is not implemented by this reference verifier`,
    };
  }

  const spec = listing.interface.spec as {
    method?: string;
    url?: string;
    responseSchema?: object;
  };
  if (!spec.url) {
    return { supported: false, reason: "listing's interface.spec has no url" };
  }

  const url = new URL(spec.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { supported: false, reason: `refusing non-http(s) scheme "${url.protocol}"` };
  }

  if (!opts.allowPrivateNetwork) {
    try {
      await assertPublicHost(url.hostname);
    } catch (err) {
      return {
        supported: true,
        reachable: false,
        latencyMs: 0,
        schemaValid: null,
        error: (err as Error).message,
      };
    }
  }

  const method = (spec.method ?? "GET").toUpperCase();
  const timeoutMs = opts.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const hasBody = !["GET", "HEAD", "DELETE"].includes(method) && opts.sampleRequestBody !== undefined;
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: "error", // don't silently follow a redirect into a private address
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(opts.sampleRequestBody) : undefined,
    });
    const latencyMs = Date.now() - start;

    const bodyText = await readCapped(res, MAX_RESPONSE_BYTES);

    if (!spec.responseSchema) {
      return { supported: true, reachable: true, statusCode: res.status, latencyMs, schemaValid: null };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return {
        supported: true,
        reachable: true,
        statusCode: res.status,
        latencyMs,
        schemaValid: false,
        schemaErrors: ["response body is not valid JSON"],
      };
    }

    const validate = ajv.compile(spec.responseSchema);
    const valid = validate(parsed);
    return {
      supported: true,
      reachable: true,
      statusCode: res.status,
      latencyMs,
      schemaValid: valid,
      schemaErrors: valid ? undefined : validate.errors?.map((e) => `${e.instancePath} ${e.message}`),
    };
  } catch (err) {
    return {
      supported: true,
      reachable: false,
      latencyMs: Date.now() - start,
      schemaValid: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeded ${maxBytes} byte cap`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}
