#!/usr/bin/env node
// Pushes the local .env.local values into the linked Vercel project.
// GCP_PRIVATE_KEY is stored with its newlines still escaped as \n, matching
// what src/lib/gcs.ts unescapes at runtime, so the value is passed through
// verbatim rather than through a shell that would interpret the backslashes.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const KEYS = [
  "GCP_BUCKET",
  "GCP_PROJECT_ID",
  "GCP_EMAIL",
  "GCP_CLIENT_ID",
  "GCP_PRIVATE_KEY_ID",
  "GCP_PRIVATE_KEY",
  "UPLOAD_ROOT_PREFIX",
  "UPLOAD_ACCESS_CODE",
  "SESSION_SECRET",
];

const TARGETS = ["production", "preview", "development"];

const env = parse(readFileSync(".env.local", "utf8"));
const overrides = parse(process.argv[2] ? readFileSync(process.argv[2], "utf8") : "");
Object.assign(env, overrides);

for (const key of KEYS) {
  const value = env[key];
  if (!value) {
    console.error(`skip ${key}: not set locally`);
    continue;
  }
  for (const target of TARGETS) {
    try {
      execFileSync("npx", ["vercel", "env", "rm", key, target, "--yes"], { stdio: "ignore" });
    } catch {
      // not present yet
    }
    execFileSync("npx", ["vercel", "env", "add", key, target], {
      input: value,
      stdio: ["pipe", "ignore", "inherit"],
    });
    console.log(`set ${key} -> ${target} (${value.length} chars)`);
  }
}

function parse(raw) {
  const out = {};
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}
