import { NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { BUCKET, storage } from "@/lib/gcs";
import { sanitizeSegments } from "@/lib/keys";

export const runtime = "nodejs";

const TTL_MINUTES = 15;

export async function POST(req: Request) {
  if (!(await hasSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { key?: string; disposition?: "inline" | "attachment" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
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

  const filename = key.split("/").pop() ?? "download";
  const [url] = await storage()
    .bucket(BUCKET)
    .file(key)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + TTL_MINUTES * 60_000,
      responseDisposition:
        body.disposition === "inline"
          ? "inline"
          : `attachment; filename="${filename.replace(/"/g, "")}"`,
    });

  return NextResponse.json({ url, expiresInMinutes: TTL_MINUTES });
}
