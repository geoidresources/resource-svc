import type { DownloadTask, RemoteObject } from "./types";

export async function listFolder(
  prefix: string,
  onProgress?: (count: number, bytes: number) => void,
  shouldStop?: () => boolean,
): Promise<RemoteObject[]> {
  const out: RemoteObject[] = [];
  let bytes = 0;
  let pageToken: string | null = null;
  do {
    if (shouldStop?.()) throw new DOMException("aborted", "AbortError");
    const res = await fetch("/api/download/manifest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix, pageToken }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `listing failed (${res.status})`);
    }
    const data = (await res.json()) as {
      items: RemoteObject[];
      nextPageToken: string | null;
    };
    for (const item of data.items) {
      out.push(item);
      bytes += item.size;
    }
    onProgress?.(out.length, bytes);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

export function tasksFor(items: RemoteObject[]): DownloadTask[] {
  return items.map((item) => ({
    ...item,
    received: 0,
    status: "pending",
    attempts: 0,
  }));
}
