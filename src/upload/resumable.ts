export const CHUNK_MULTIPLE = 256 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

export class SessionGoneError extends Error {}

interface XhrResult {
  status: number;
  header: (name: string) => string | null;
  body: string;
}

function request(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Blob | null;
  onProgress?: (loaded: number) => void;
  register?: (xhr: XMLHttpRequest) => void;
}): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method, opts.url, true);
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v);
    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => opts.onProgress!(e.loaded);
    }
    xhr.onload = () =>
      resolve({
        status: xhr.status,
        header: (n) => xhr.getResponseHeader(n),
        body: xhr.responseText ?? "",
      });
    xhr.onerror = () => reject(new Error("network error"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    opts.register?.(xhr);
    xhr.send(opts.body ?? null);
  });
}

export async function startSession(
  url: string,
  headers: Record<string, string>,
  register?: (xhr: XMLHttpRequest) => void,
): Promise<string> {
  const res = await request({ method: "POST", url, headers, register });
  if (res.status !== 200 && res.status !== 201) throw new HttpError(res.status, res.body);
  const location = res.header("Location");
  if (!location) {
    throw new Error(
      "resumable session started but Location header is unreadable — add Location to the bucket CORS responseHeader list",
    );
  }
  return location;
}

function parseCommitted(rangeHeader: string | null): number {
  if (!rangeHeader) return 0;
  const m = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
  return m ? Number(m[2]) + 1 : 0;
}

export interface ChunkResult {
  done: boolean;
  committed: number;
}

export async function probeSession(sessionUri: string, total: number): Promise<ChunkResult> {
  const res = await request({
    method: "PUT",
    url: sessionUri,
    headers: { "Content-Range": `bytes */${total}` },
  });
  if (res.status === 200 || res.status === 201) return { done: true, committed: total };
  if (res.status === 308) return { done: false, committed: parseCommitted(res.header("Range")) };
  if (res.status === 404 || res.status === 410) throw new SessionGoneError(`session gone (${res.status})`);
  throw new HttpError(res.status, res.body);
}

export async function putChunk(opts: {
  sessionUri: string;
  blob: Blob;
  start: number;
  total: number;
  onProgress?: (absoluteBytes: number) => void;
  register?: (xhr: XMLHttpRequest) => void;
}): Promise<ChunkResult> {
  const { sessionUri, blob, start, total } = opts;
  // A zero-length object has no byte range to declare; "bytes */0" finalises it.
  const contentRange =
    blob.size === 0 ? `bytes */${total}` : `bytes ${start}-${start + blob.size - 1}/${total}`;

  const res = await request({
    method: "PUT",
    url: sessionUri,
    headers: { "Content-Range": contentRange },
    body: blob.size === 0 ? null : blob,
    onProgress: opts.onProgress ? (loaded) => opts.onProgress!(start + loaded) : undefined,
    register: opts.register,
  });

  if (res.status === 200 || res.status === 201) return { done: true, committed: total };
  if (res.status === 308) {
    return { done: false, committed: parseCommitted(res.header("Range")) };
  }
  if (res.status === 404 || res.status === 410) {
    throw new SessionGoneError(`session gone (${res.status})`);
  }
  throw new HttpError(res.status, res.body);
}
