import { NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { BUCKET, storage } from "@/lib/gcs";
import { sanitizeSegments } from "@/lib/keys";

export const runtime = "nodejs";
export const maxDuration = 60;

const TTL_MINUTES = 60;
const MAX_KEYS = 200;

type Disposition = "inline" | "attachment";

function signRead(key: string, disposition: Disposition): Promise<string> {
  const filename = key.split("/").pop() ?? "download";
  return storage()
    .bucket(BUCKET)
    .file(key)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + TTL_MINUTES * 60_000,
      responseDisposition:
        disposition === "inline"
          ? "inline"
          : `attachment; filename="${filename.replace(/"/g, "")}"`,
    })
    .then(([url]) => url);
}

export async function POST(req: Request) {
  if (!(await hasSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { key?: string; keys?: string[]; disposition?: Disposition };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const disposition: Disposition =
    body.disposition === "inline" ? "inline" : "attachment";

  if (Array.isArray(body.keys)) {
    if (body.keys.length > MAX_KEYS) {
      return NextResponse.json(
        { error: `at most ${MAX_KEYS} keys per request` },
        { status: 400 },
      );
    }
    const grants = await Promise.all(
      body.keys.map(async (raw) => {
        try {
          const key = sanitizeSegments(raw).join("/");
          if (!key) throw new Error("missing key");
          return { key: raw, url: await signRead(key, disposition) };
        } catch (err) {
          return {
            key: raw,
            error: err instanceof Error ? err.message : "bad key",
          };
        }
      }),
    );
    return NextResponse.json({ grants, expiresInMinutes: TTL_MINUTES });
  }

  let key: string;
  try {
    key = sanitizeSegments(body.key ?? "").join("/");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad key" },
      { status: 400 },
    );
  }
  if (!key) return NextResponse.json({ error: "missing key" }, { status: 400 });

  return NextResponse.json({
    url: await signRead(key, disposition),
    expiresInMinutes: TTL_MINUTES,
  });
}
