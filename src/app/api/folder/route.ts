import { NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { BUCKET, storage } from "@/lib/gcs";
import { isWritable, normalizePrefix, sanitizeSegments } from "@/lib/keys";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await hasSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { prefix?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  let marker: string;
  try {
    const parent = normalizePrefix(body.prefix ?? "");
    if (!isWritable(parent)) throw new Error("this folder is read-only");
    const name = sanitizeSegments(body.name ?? "");
    if (name.length !== 1) throw new Error("folder name must be a single path segment");
    marker = `${parent}${name[0]}/`;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad folder" },
      { status: 400 },
    );
  }

  const file = storage().bucket(BUCKET).file(marker);
  const [exists] = await file.exists();
  if (exists) return NextResponse.json({ prefix: marker, created: false });

  try {
    // GCS has no directories: a trailing-slash zero-byte object is what every
    // console renders as an empty folder.
    await file.save("", { contentType: "application/x-www-form-urlencoded;charset=UTF-8" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "create failed";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  return NextResponse.json({ prefix: marker, created: true });
}
