#!/usr/bin/env node
// Exercises the exact protocol the browser uses: sign a v4 resumable-init URL
// server-side, POST it to open a session, then PUT sized chunks with
// Content-Range. Run before trusting a deploy.
import { Storage } from "@google-cloud/storage";
import { readFileSync } from "node:fs";

loadEnv(".env.local");
loadEnv(".env");

const BUCKET = process.env.GCP_BUCKET || "geoidresources";
const ROOT = (process.env.UPLOAD_ROOT_PREFIX || "uploads").replace(/^\/+|\/+$/g, "");
const KEY = `${ROOT}/_smoke/${Date.now()}-resumable.bin`;
const CHUNK = 256 * 1024;
const TOTAL = CHUNK * 3 + 1234;

const storage = new Storage({
  projectId: required("GCP_PROJECT_ID"),
  credentials: {
    client_email: required("GCP_EMAIL"),
    private_key: required("GCP_PRIVATE_KEY").replace(/\\n/g, "\n"),
  },
});

const file = storage.bucket(BUCKET).file(KEY);

const [signedUrl] = await file.getSignedUrl({
  version: "v4",
  action: "resumable",
  expires: Date.now() + 15 * 60_000,
  contentType: "application/octet-stream",
});
console.log("1. signed resumable-init URL  ok");

const init = await fetch(signedUrl, {
  method: "POST",
  headers: { "x-goog-resumable": "start", "content-type": "application/octet-stream" },
});
if (init.status !== 200 && init.status !== 201) {
  fail(`init POST -> ${init.status}\n${await init.text()}`);
}
const sessionUri = init.headers.get("location");
if (!sessionUri) fail("init POST returned no Location header");
console.log("2. session opened             ok");

const payload = Buffer.alloc(TOTAL);
for (let i = 0; i < TOTAL; i++) payload[i] = i % 251;

let offset = 0;
let chunks = 0;
while (offset < TOTAL) {
  const end = Math.min(offset + CHUNK, TOTAL);
  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: { "Content-Range": `bytes ${offset}-${end - 1}/${TOTAL}` },
    body: payload.subarray(offset, end),
  });
  chunks++;
  if (res.status === 200 || res.status === 201) {
    offset = TOTAL;
    break;
  }
  if (res.status !== 308) fail(`chunk PUT -> ${res.status}\n${await res.text()}`);
  const range = res.headers.get("range");
  offset = range ? Number(/bytes=\d+-(\d+)/.exec(range)[1]) + 1 : offset;
  const probe = await fetch(sessionUri, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${TOTAL}` },
  });
  if (probe.status === 308) {
    const r = probe.headers.get("range");
    const committed = r ? Number(/bytes=\d+-(\d+)/.exec(r)[1]) + 1 : 0;
    if (committed !== offset) fail(`resume probe disagrees: ${committed} vs ${offset}`);
  }
}
console.log(`3. uploaded ${chunks} chunks       ok`);

const [meta] = await file.getMetadata();
if (Number(meta.size) !== TOTAL) fail(`size mismatch: ${meta.size} != ${TOTAL}`);
console.log(`4. object size ${meta.size} bytes  ok`);

const [buf] = await file.download();
if (!buf.equals(payload)) fail("downloaded bytes differ from what was sent");
console.log("5. round-trip byte-identical  ok");

let cleaned = true;
try {
  await file.delete();
  console.log("6. cleaned up                 ok");
} catch (err) {
  cleaned = false;
  console.log(`6. cleanup skipped            ${err.code === 403 ? "no storage.objects.delete" : err.message}`);
}

console.log(`\nPASS  gs://${BUCKET}/${KEY}`);
if (!cleaned) console.log(`      remove manually: gcloud storage rm gs://${BUCKET}/${KEY}`);

function fail(msg) {
  console.error("\nFAIL:", msg);
  process.exit(1);
}

function required(name) {
  const v = process.env[name];
  if (!v) fail(`missing env ${name}`);
  return v;
}

function loadEnv(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}
