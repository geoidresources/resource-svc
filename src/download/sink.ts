import { ZipWriter } from "./zip";
import type { RemoteObject } from "./types";

export interface DownloadSink {
  readonly label: string;
  // A zip is one append-only stream, so its entries cannot be written in parallel.
  readonly concurrency: number;
  // Whether the destination survives between runs: a folder on disk keeps what it
  // already has, so a transfer can be paused or retried, while a half-written
  // archive is only ever scrap.
  readonly resumable: boolean;
  alreadyHave(item: RemoteObject): Promise<boolean>;
  write(
    item: RemoteObject,
    body: ReadableStream<Uint8Array<ArrayBuffer>>,
    onProgress: (received: number) => void,
  ): Promise<void>;
  close(): Promise<void>;
  discard(): Promise<void>;
}

const ILLEGAL = /[\\/:*?"<>|\x00-\x1f]/g;

// Windows rejects these outright and macOS mangles trailing dots; a single bad
// object name would otherwise fail the whole folder.
function safeSegment(name: string): string {
  const cleaned = name.replace(ILLEGAL, "_").replace(/[. ]+$/, "");
  return cleaned.length > 0 ? cleaned : "_";
}

function segmentsOf(path: string): string[] {
  return path
    .split("/")
    .filter((s) => s.length > 0 && s !== "." && s !== "..")
    .map(safeSegment);
}

export class DirectorySink implements DownloadSink {
  readonly concurrency = 4;
  readonly resumable = true;
  private dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  private open: FileSystemWritableFileStream | null = null;

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  get label(): string {
    return `${this.root.name}/`;
  }

  private directory(segments: string[]): Promise<FileSystemDirectoryHandle> {
    const key = segments.join("/");
    let handle = this.dirs.get(key);
    if (!handle) {
      handle = segments.reduce(
        async (parent, name) =>
          (await parent).getDirectoryHandle(name, { create: true }),
        Promise.resolve(this.root),
      );
      this.dirs.set(key, handle);
    }
    return handle;
  }

  async alreadyHave(item: RemoteObject): Promise<boolean> {
    const segments = segmentsOf(item.path);
    const name = segments.pop();
    if (!name) return false;
    try {
      const dir = await this.directory(segments);
      const file = await (await dir.getFileHandle(name)).getFile();
      return file.size === item.size;
    } catch {
      return false;
    }
  }

  async write(
    item: RemoteObject,
    body: ReadableStream<Uint8Array<ArrayBuffer>>,
    onProgress: (received: number) => void,
  ): Promise<void> {
    const segments = segmentsOf(item.path);
    const name = segments.pop();
    if (!name) throw new Error(`cannot save an object named ${item.path}`);
    const dir = await this.directory(segments);
    const handle = await dir.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    this.open = stream;

    let received = 0;
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await stream.write(value);
        received += value.length;
        onProgress(received);
      }
      await stream.close();
    } catch (err) {
      await stream.abort().catch(() => undefined);
      throw err;
    } finally {
      reader.releaseLock();
      this.open = null;
    }
  }

  async close(): Promise<void> {}

  async discard(): Promise<void> {
    await this.open?.abort().catch(() => undefined);
    this.open = null;
  }
}

interface ByteStream {
  write: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
}

export function fileStreamBytes(
  stream: FileSystemWritableFileStream,
): ByteStream {
  return {
    write: (chunk) => stream.write(chunk),
    close: () => stream.close(),
    abort: () => stream.abort().catch(() => undefined),
  };
}

// Without a writable file handle the archive can only be handed over at the end.
// Chunks are batched into large Blobs so the browser can spill them to disk
// instead of holding the whole zip as live JS memory.
export function blobBytes(filename: string): ByteStream {
  const FLUSH_AT = 8 * 1024 * 1024;
  const parts: Blob[] = [];
  let pending: Uint8Array<ArrayBuffer>[] = [];
  let pendingBytes = 0;

  const flush = () => {
    if (pending.length === 0) return;
    parts.push(new Blob(pending as BlobPart[]));
    pending = [];
    pendingBytes = 0;
  };

  return {
    async write(chunk) {
      // The caller may reuse the buffer behind this view once write() resolves.
      pending.push(chunk.slice());
      pendingBytes += chunk.length;
      if (pendingBytes >= FLUSH_AT) flush();
    },
    async close() {
      flush();
      const url = URL.createObjectURL(
        new Blob(parts, { type: "application/zip" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    async abort() {
      parts.length = 0;
      pending = [];
      pendingBytes = 0;
    },
  };
}

export class ZipSink implements DownloadSink {
  readonly concurrency = 1;
  readonly resumable = false;
  private zip: ZipWriter;

  constructor(
    readonly label: string,
    private readonly bytes: ByteStream,
  ) {
    this.zip = new ZipWriter((chunk) => this.bytes.write(chunk));
  }

  async alreadyHave(): Promise<boolean> {
    return false;
  }

  write(
    item: RemoteObject,
    body: ReadableStream<Uint8Array<ArrayBuffer>>,
    onProgress: (received: number) => void,
  ): Promise<void> {
    return this.zip.add(
      {
        path: item.path,
        size: item.size,
        modified: item.updated ? new Date(item.updated) : null,
      },
      body,
      onProgress,
    );
  }

  async close(): Promise<void> {
    await this.zip.finish();
    await this.bytes.close();
  }

  async discard(): Promise<void> {
    await this.bytes.abort();
  }
}
