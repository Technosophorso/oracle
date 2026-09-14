#!/usr/bin/env tsx
// Minimal CLI for minting/inspecting agent identities.
//
//   tsx src/identity/cli.ts new [output-file]
//   tsx src/identity/cli.ts show <identity-file>

import { createIdentity, loadIdentity, saveIdentity } from "./keys.js";

function main() {
  const [cmd, arg] = process.argv.slice(2);

  if (cmd === "new") {
    const identity = createIdentity();
    if (arg) {
      saveIdentity(identity, arg);
      console.log(`Saved new identity to ${arg}`);
    }
    console.log(`npub: ${identity.npub}`);
    console.log(`nsec: ${identity.nsec}  (keep this secret!)`);
    return;
  }

  if (cmd === "show" && arg) {
    const identity = loadIdentity(arg);
    console.log(`npub: ${identity.npub}`);
    return;
  }

  console.error("Usage:");
  console.error("  tsx src/identity/cli.ts new [output-file]");
  console.error("  tsx src/identity/cli.ts show <identity-file>");
  process.exit(1);
}

main();
