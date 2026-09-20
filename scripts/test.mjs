#!/usr/bin/env node
// Finds every src/**/*.test.ts file and runs them through tsx's test
// runner integration. A dedicated script instead of a glob in
// package.json because neither `node --test <dir>` (its built-in
// auto-discovery doesn't match .ts files on this Node/tsx combination)
// nor a literal glob string passed as an argument reliably works
// cross-platform (Windows has no shell-level glob expansion at all).

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function findTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (entry.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

const files = findTestFiles(join(root, "src"));
if (files.length === 0) {
  console.error("No *.test.ts files found under src/.");
  process.exit(1);
}

const result = spawnSync("npx", ["tsx", "--test", ...files], {
  stdio: "inherit",
  shell: process.platform === "win32",
  cwd: root,
});
process.exit(result.status ?? 1);
