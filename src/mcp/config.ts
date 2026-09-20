// Configuration and lazy local state for the MCP server. Goal: adding
// this server to any MCP client's config should be a one-line change with
// zero required setup for read-only tools — identity is auto-generated
// and persisted on first use if none is configured, the same way a fresh
// agent would mint one per the design spec's §4.1 ("minting a new
// identity is free and expected to happen constantly").
//
// Publishing (registry_publish_listing) additionally needs a FUNDED
// Arweave wallet — that can never be auto-provisioned (it would need real
// money), so a wallet is auto-created empty/unfunded and the publish tool
// surfaces a clear, actionable error pointing at its address if it has no
// balance.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JWKInterface } from "arweave/node/lib/wallet.js";
import { createIdentity, loadIdentity, saveIdentity, type Identity } from "../identity/keys.js";
import { DEFAULT_RELAYS } from "../coordination/relay.js";
import { createArweaveClient, generateWallet, MAINNET } from "../registry/arweave.js";

const ORACLE_HOME = process.env.ORACLE_HOME ?? join(homedir(), ".oracle");
mkdirSync(ORACLE_HOME, { recursive: true });

export const CONFIG = {
  home: ORACLE_HOME,
  identityFile: process.env.ORACLE_IDENTITY_FILE ?? join(ORACLE_HOME, "identity.json"),
  walletFile: process.env.ORACLE_WALLET_FILE ?? join(ORACLE_HOME, "wallet.json"),
  indexFile: process.env.ORACLE_INDEX_FILE ?? join(ORACLE_HOME, "index.json"),
  relays: process.env.ORACLE_RELAYS ? process.env.ORACLE_RELAYS.split(",").map((s) => s.trim()) : DEFAULT_RELAYS,
  gateway: process.env.ORACLE_GATEWAY ?? `https://${MAINNET.host}`,
};

let cachedIdentity: Identity | undefined;

/** Returns the configured identity, generating and persisting a new one on first use. */
export function getOrCreateIdentity(): Identity {
  if (cachedIdentity) return cachedIdentity;
  if (existsSync(CONFIG.identityFile)) {
    cachedIdentity = loadIdentity(CONFIG.identityFile);
  } else {
    cachedIdentity = createIdentity();
    saveIdentity(cachedIdentity, CONFIG.identityFile);
  }
  return cachedIdentity;
}

let cachedWallet: JWKInterface | undefined;

/**
 * Returns the configured Arweave wallet, generating and persisting a new
 * (unfunded) one on first use. Callers that need to publish MUST check
 * the wallet's balance themselves and surface a clear funding instruction
 * if it's zero — this function only guarantees a wallet exists, never
 * that it can pay for anything.
 */
export async function getOrCreateWallet(): Promise<JWKInterface> {
  if (cachedWallet) return cachedWallet;
  if (existsSync(CONFIG.walletFile)) {
    cachedWallet = JSON.parse(readFileSync(CONFIG.walletFile, "utf-8")) as JWKInterface;
  } else {
    const client = createArweaveClient(gatewayToOptions(CONFIG.gateway));
    cachedWallet = await generateWallet(client);
    writeFileSync(CONFIG.walletFile, JSON.stringify(cachedWallet, null, 2), { encoding: "utf-8", mode: 0o600 });
  }
  return cachedWallet!;
}

export function gatewayToOptions(gateway: string) {
  const url = new URL(gateway);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    protocol: (url.protocol === "https:" ? "https" : "http") as "http" | "https",
  };
}
