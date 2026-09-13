import { NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { BUCKET, storage } from "@/lib/gcs";
import { normalizePrefix } from "@/lib/keys";

export const runtime = "nodejs";
export const maxDuration = 60;

const PAGE_SIZE = 1000;

export async function POST(req: Request) {
  if (!(await hasSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { prefix?: string; pageToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  let prefix: string;
  try {
    prefix = normalizePrefix(body.prefix ?? "");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad prefix" },
      { status: 400 },
    );
  }

  const [files, , apiResponse] = await storage().bucket(BUCKET).getFiles({
    prefix,
    maxResults: PAGE_SIZE,
    autoPaginate: false,
    pageToken: body.pageToken,
  });

  return NextResponse.json({
    prefix,
    items: files.map((f) => ({
      path: f.name.slice(prefix.length),
      size: Number(f.metadata.size ?? 0),
    })),
    nextPageToken: (apiResponse as { nextPageToken?: string } | undefined)?.nextPageToken ?? null,
  });
}
