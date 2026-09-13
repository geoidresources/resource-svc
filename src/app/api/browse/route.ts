import { NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { BUCKET, ROOT_PREFIX, storage } from "@/lib/gcs";
import { isWritable, normalizePrefix } from "@/lib/keys";

export const runtime = "nodejs";
export const maxDuration = 60;

const PAGE_SIZE = 500;

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
    delimiter: "/",
    maxResults: PAGE_SIZE,
    autoPaginate: false,
    pageToken: body.pageToken,
  });

  const raw = apiResponse as { prefixes?: string[]; nextPageToken?: string } | undefined;

  const folders = (raw?.prefixes ?? []).map((p) => ({
    name: p.slice(prefix.length).replace(/\/$/, ""),
    prefix: p,
  }));

  const items = files
    // A "folder" created through a console is a zero-byte object whose name is
    // the prefix itself; it is the directory, not a file inside it.
    .filter((f) => f.name !== prefix)
    .map((f) => ({
      name: f.name.slice(prefix.length),
      key: f.name,
      size: Number(f.metadata.size ?? 0),
      updated: f.metadata.updated ?? null,
      contentType: f.metadata.contentType ?? "application/octet-stream",
    }));

  return NextResponse.json({
    root: ROOT_PREFIX,
    prefix,
    writable: isWritable(prefix),
    folders,
    files: items,
    nextPageToken: raw?.nextPageToken ?? null,
  });
}
