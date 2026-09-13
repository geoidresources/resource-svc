import { ROOT_PREFIX } from "./gcs";

const DOT_SEGMENT = /^\.\.?$/;
const CONTROL = /[\x00-\x1f\x7f]/;

export function sanitizeSegments(raw: string): string[] {
  return raw
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      if (DOT_SEGMENT.test(s)) throw new Error(`illegal path segment: ${s}`);
      if (CONTROL.test(s)) throw new Error("path contains control characters");
      if (s.length > 200) throw new Error("path segment too long");
      return s;
    });
}

export function objectKey(destPrefix: string, relPath: string): string {
  const dest = sanitizeSegments(destPrefix);
  const rel = sanitizeSegments(relPath);
  if (rel.length === 0) throw new Error("empty file path");
  const key = [ROOT_PREFIX, ...dest, ...rel].filter(Boolean).join("/");
  if (new TextEncoder().encode(key).length > 1024) {
    throw new Error("object key exceeds 1024 bytes");
  }
  return key;
}

const TYPES: Record<string, string> = {
  las: "application/vnd.las",
  laz: "application/vnd.laszip",
  e57: "application/octet-stream",
  ply: "application/octet-stream",
  tif: "image/tiff",
  tiff: "image/tiff",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  json: "application/json",
  geojson: "application/geo+json",
  csv: "text/csv",
  txt: "text/plain",
  prj: "text/plain",
  xml: "application/xml",
  zip: "application/zip",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  obj: "text/plain",
  terrain: "application/octet-stream",
  b3dm: "application/octet-stream",
  pnts: "application/octet-stream",
};

export function contentTypeFor(relPath: string): string {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

export function normalizePrefix(raw: string): string {
  const segments = sanitizeSegments(raw);
  return segments.length === 0 ? "" : segments.join("/") + "/";
}

export function isWritable(prefix: string): boolean {
  if (!ROOT_PREFIX) return true;
  return prefix === `${ROOT_PREFIX}/` || prefix.startsWith(`${ROOT_PREFIX}/`);
}

export function keyUnderPrefix(prefix: string, relPath: string): string {
  const rel = sanitizeSegments(relPath);
  if (rel.length === 0) throw new Error("empty file path");
  if (!isWritable(prefix)) throw new Error(`writes are only allowed under ${ROOT_PREFIX}/`);
  const key = prefix + rel.join("/");
  if (new TextEncoder().encode(key).length > 1024) {
    throw new Error("object key exceeds 1024 bytes");
  }
  return key;
}
