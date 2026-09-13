import { saveTasks } from "./idb";
import {
  CHUNK_MULTIPLE,
  HttpError,
  SessionGoneError,
  probeSession,
  putChunk,
  startSession,
} from "./resumable";
import type { FileSource, FileTask, Grant, Snapshot } from "./types";

const MINT_BATCH = 100;
const MINT_DEBOUNCE_MS = 40;
const MAX_ATTEMPTS = 6;
const EMIT_INTERVAL_MS = 150;

export interface EngineOptions {
  jobId: string;
  prefix: string;
  concurrency: number;
  chunkSize: number;
  onChange: (snapshot: Snapshot) => void;
}

interface MintRequest {
  task: FileTask;
  resolve: (grant: Grant) => void;
  reject: (err: Error) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GCS charges an overwrite against storage.objects.delete. The service account
// now holds that, so this should not fire — it stays as a readable fallback in
// case the binding is ever reverted to create-only.
function isOverwriteDenied(err: unknown): boolean {
  return err instanceof HttpError && err.status === 403 && /storage\.objects\.delete/.test(err.body);
}

export class UploadEngine {
  private tasks: FileTask[];
  private sources: Map<string, FileSource>;
  private opts: EngineOptions;
  private running = false;
  private cursor = 0;
  private inFlight = new Set<XMLHttpRequest>();
  private mintQueue: MintRequest[] = [];
  private mintTimer: ReturnType<typeof setTimeout> | null = null;
  private samples: { t: number; bytes: number }[] = [];
  private lastEmit = 0;
  private dirty = new Set<string>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(sources: FileSource[], tasks: FileTask[], opts: EngineOptions) {
    this.sources = new Map(sources.map((s) => [s.relPath, s]));
    this.tasks = tasks;
    this.opts = opts;
  }

  snapshot(): Snapshot {
    let uploadedBytes = 0;
    let totalBytes = 0;
    let doneCount = 0;
    let skippedCount = 0;
    let conflictCount = 0;
    let errorCount = 0;
    for (const t of this.tasks) {
      totalBytes += t.size;
      uploadedBytes += t.uploaded;
      if (t.status === "done") {
        doneCount++;
        if (t.preexisting) skippedCount++;
      }
      if (t.status === "conflict") conflictCount++;
      if (t.status === "error") errorCount++;
    }
    const bps = this.throughput();
    const remaining = totalBytes - uploadedBytes;
    return {
      tasks: this.tasks,
      totalBytes,
      uploadedBytes,
      doneCount,
      skippedCount,
      conflictCount,
      errorCount,
      running: this.running,
      bytesPerSecond: bps,
      etaSeconds: bps > 0 && remaining > 0 ? remaining / bps : null,
    };
  }

  private throughput(): number {
    const now = Date.now();
    this.samples = this.samples.filter((s) => now - s.t < 15_000);
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    return dt > 0 ? Math.max(0, (last.bytes - first.bytes) / dt) : 0;
  }

  // snapshot() walks every task, and byte-progress events fire continuously on
  // each parallel transfer. Unthrottled that is O(files) per event, which stalls
  // the UI thread on a folder with tens of thousands of entries.
  private emit(force = false) {
    const now = Date.now();
    if (!force && now - this.lastEmit < EMIT_INTERVAL_MS) return;
    this.lastEmit = now;
    const snapshot = this.snapshot();
    this.samples.push({ t: now, bytes: snapshot.uploadedBytes });
    this.opts.onChange(snapshot);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.cursor = 0;
    for (const t of this.tasks) {
      if (t.status === "error") {
        t.status = "pending";
        t.error = undefined;
        t.attempts = 0;
      }
    }
    this.flushTimer = setInterval(() => void this.flushDirty(), 2000);
    const workers = Array.from({ length: this.opts.concurrency }, () => this.worker());
    void Promise.all(workers).finally(() => {
      this.running = false;
      if (this.flushTimer) clearInterval(this.flushTimer);
      this.flushTimer = null;
      void this.flushDirty();
      this.emit(true);
    });
    this.emit(true);
  }

  pause() {
    this.running = false;
    for (const xhr of this.inFlight) xhr.abort();
    this.inFlight.clear();
  }

  private nextTask(): FileTask | null {
    while (this.cursor < this.tasks.length) {
      const t = this.tasks[this.cursor++];
      if (t.status === "pending") return t;
    }
    return null;
  }

  private async worker() {
    for (;;) {
      if (!this.running) return;
      const task = this.nextTask();
      if (!task) return;
      task.status = "uploading";
      this.emit();
      try {
        await this.uploadOne(task);
        task.status = "done";
        task.uploaded = task.size;
      } catch (err) {
        if (!this.running && err instanceof DOMException && err.name === "AbortError") {
          task.status = "pending";
        } else if (isOverwriteDenied(err)) {
          task.status = "conflict";
          task.error = "already exists and the service account lacks storage.objects.delete";
        } else {
          task.status = "error";
          task.error = err instanceof Error ? err.message : String(err);
        }
      }
      this.dirty.add(task.relPath);
      this.emit();
    }
  }

  private async uploadOne(task: FileTask) {
    for (let attempt = task.attempts; attempt < MAX_ATTEMPTS; attempt++) {
      if (!this.running) throw new DOMException("aborted", "AbortError");
      try {
        await this.transfer(task);
        return;
      } catch (err) {
        task.attempts = attempt + 1;
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        if (err instanceof SessionGoneError) {
          task.sessionUri = undefined;
          task.uploaded = 0;
          continue;
        }
        if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          throw err;
        }
        if (attempt + 1 >= MAX_ATTEMPTS) throw err;
        await sleep(Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500);
      }
    }
  }

  private async transfer(task: FileTask) {
    const source = this.sources.get(task.relPath);
    if (!source) throw new Error("file no longer available — re-select the folder");

    if (!task.sessionUri) {
      const grant = await this.mint(task);
      if (grant.error || !grant.url || !grant.headers) throw new Error(grant.error ?? "no grant");
      task.key = grant.key;
      task.sessionUri = await startSession(grant.url, grant.headers, (x) => this.track(x));
      task.uploaded = 0;
      this.dirty.add(task.relPath);
    } else {
      const probe = await probeSession(task.sessionUri, task.size);
      if (probe.done) {
        task.uploaded = task.size;
        return;
      }
      task.uploaded = probe.committed;
    }

    const file = await source.getFile();
    if (file.size !== task.size) throw new Error("file changed on disk since it was scanned");

    if (file.size === 0) {
      await putChunk({
        sessionUri: task.sessionUri,
        blob: file,
        start: 0,
        total: 0,
        register: (x) => this.track(x),
      });
      return;
    }

    const chunkSize = Math.max(CHUNK_MULTIPLE, Math.floor(this.opts.chunkSize / CHUNK_MULTIPLE) * CHUNK_MULTIPLE);

    while (task.uploaded < task.size) {
      if (!this.running) throw new DOMException("aborted", "AbortError");
      const start = task.uploaded;
      const end = Math.min(start + chunkSize, task.size);
      const res = await putChunk({
        sessionUri: task.sessionUri,
        blob: file.slice(start, end),
        start,
        total: task.size,
        onProgress: (abs) => {
          task.uploaded = abs;
          this.emit();
        },
        register: (x) => this.track(x),
      });
      task.uploaded = res.done ? task.size : res.committed;
      this.dirty.add(task.relPath);
      this.emit();
      if (res.done) return;
      if (res.committed <= start && end < task.size) {
        throw new Error("server committed no bytes for this chunk");
      }
    }
  }

  private track(xhr: XMLHttpRequest) {
    this.inFlight.add(xhr);
    xhr.addEventListener("loadend", () => this.inFlight.delete(xhr));
  }

  private mint(task: FileTask): Promise<Grant> {
    return new Promise((resolve, reject) => {
      this.mintQueue.push({ task, resolve, reject });
      if (this.mintQueue.length >= MINT_BATCH) {
        void this.flushMint();
      } else if (!this.mintTimer) {
        this.mintTimer = setTimeout(() => void this.flushMint(), MINT_DEBOUNCE_MS);
      }
    });
  }

  private async flushMint() {
    if (this.mintTimer) {
      clearTimeout(this.mintTimer);
      this.mintTimer = null;
    }
    const batch = this.mintQueue.splice(0, MINT_BATCH);
    if (batch.length === 0) return;

    try {
      const res = await fetch("/api/upload/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prefix: this.opts.prefix,
          files: batch.map((b) => ({ path: b.task.relPath })),
        }),
      });
      if (!res.ok) throw new Error(`init ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const { grants } = (await res.json()) as { grants: Grant[] };
      const byPath = new Map(grants.map((g) => [g.path, g]));
      for (const item of batch) {
        const grant = byPath.get(item.task.relPath);
        if (grant) item.resolve(grant);
        else item.reject(new Error("no grant returned"));
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const item of batch) item.reject(error);
    }
  }

  private async flushDirty() {
    if (this.dirty.size === 0) return;
    const paths = [...this.dirty];
    this.dirty.clear();
    const set = new Set(paths);
    await saveTasks(
      this.opts.jobId,
      this.tasks.filter((t) => set.has(t.relPath)),
    ).catch(() => undefined);
  }
}
