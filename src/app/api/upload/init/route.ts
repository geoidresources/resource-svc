import { NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { BUCKET, signResumableInit } from "@/lib/gcs";
import { contentTypeFor, keyUnderPrefix, normalizePrefix } from "@/lib/keys";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BATCH = 200;
const TTL_MINUTES = Number(process.env.SIGNED_URL_TTL_MINUTES || 120);

type Req = {
  prefix?: string;
  files?: { path: string; contentType?: string }[];
};

export async function POST(req: Request) {
  if (!(await hasSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Req;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const files = body.files ?? [];
  if (files.length === 0) {
    return NextResponse.json({ error: "no files" }, { status: 400 });
  }
  if (files.length > MAX_BATCH) {
    return NextResponse.json({ error: `max ${MAX_BATCH} files per request` }, { status: 400 });
  }

  const grants = await Promise.all(
    files.map(async (f) => {
      try {
        const key = keyUnderPrefix(normalizePrefix(body.prefix ?? ""), f.path);
        const contentType = f.contentType || contentTypeFor(f.path);
        const grant = await signResumableInit(key, contentType, TTL_MINUTES);
        return { path: f.path, key, ...grant };
      } catch (err) {
        return { path: f.path, error: err instanceof Error ? err.message : "sign failed" };
      }
    }),
  );

  return NextResponse.json({ bucket: BUCKET, expiresInMinutes: TTL_MINUTES, grants });
}
