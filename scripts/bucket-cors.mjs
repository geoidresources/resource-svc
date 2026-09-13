#!/usr/bin/env node
// The upload service account has no storage.buckets.* permission, so CORS is
// managed through gcloud under an admin login rather than through the SDK.
//
//   node scripts/bucket-cors.mjs           show current policy + the diff needed
//   node scripts/bucket-cors.mjs --apply   write the merged policy
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUCKET = process.env.GCP_BUCKET || "geoidresources";
const apply = process.argv.includes("--apply");

// Location carries the resumable session URI from the init POST; Range carries
// the committed offset on a 308. Without both exposed, a browser upload cannot
// start or resume, even though the PUT itself succeeds.
const REQUIRED_HEADERS = [
  "Content-Type",
  "Content-Length",
  "Content-Range",
  "Content-MD5",
  "ETag",
  "Range",
  "Location",
  "x-goog-resumable",
  "x-goog-generation",
  "x-guploader-uploadid",
];
const REQUIRED_METHODS = ["GET", "HEAD", "PUT", "POST", "OPTIONS"];

const current = JSON.parse(
  execFileSync("gcloud", ["storage", "buckets", "describe", `gs://${BUCKET}`, "--format=json(cors_config)"], {
    encoding: "utf8",
  }),
).cors_config ?? [];

console.log(`bucket: gs://${BUCKET}`);
console.log("\ncurrent policy:");
console.log(JSON.stringify(current, null, 2));

const merged = current.length > 0 ? current.map(extend) : [
  { origin: ["*"], method: REQUIRED_METHODS, responseHeader: REQUIRED_HEADERS, maxAgeSeconds: 3600 },
];

const missing = new Set();
for (const rule of current) {
  for (const h of REQUIRED_HEADERS) {
    if (!(rule.responseHeader ?? []).some((x) => x.toLowerCase() === h.toLowerCase())) missing.add(h);
  }
}

console.log("\nmerged policy:");
console.log(JSON.stringify(merged, null, 2));
console.log(`\nheaders this adds: ${missing.size ? [...missing].join(", ") : "(none — already correct)"}`);

if (!apply) {
  console.log("\nre-run with --apply to write it (needs storage.buckets.update).");
  process.exit(0);
}

const path = join(tmpdir(), `geoid-cors-${Date.now()}.json`);
writeFileSync(path, JSON.stringify(merged, null, 2));
execFileSync("gcloud", ["storage", "buckets", "update", `gs://${BUCKET}`, `--cors-file=${path}`], {
  stdio: "inherit",
});
console.log("\napplied.");

function extend(rule) {
  const headers = [...(rule.responseHeader ?? [])];
  for (const h of REQUIRED_HEADERS) {
    if (!headers.some((x) => x.toLowerCase() === h.toLowerCase())) headers.push(h);
  }
  const methods = [...(rule.method ?? [])];
  for (const m of REQUIRED_METHODS) {
    if (!methods.includes(m)) methods.push(m);
  }
  return { ...rule, method: methods, responseHeader: headers };
}
