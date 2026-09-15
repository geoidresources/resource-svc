import { HttpError } from "@/upload/resumable";
import type { DownloadSink } from "./sink";
import type { DownloadSnapshot, DownloadTask, ReadGrant } from "./types";

const MINT_BATCH = 100;
const MINT_DEBOUNCE_MS = 40;
const MAX_ATTEMPTS = 5;
const EMIT_INTERVAL_MS = 150;

export interface DownloadOptions {
  concurrency: number;
  onChange: (snapshot: DownloadSnapshot) => void;
  onClosed?: (error: string | null) => void;
}

interface MintRequest {
  task: DownloadTask;
  resolve: (url: string) => void;
  reject: (err: Error) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DownloadEngine {
  private tasks: DownloadTask[];
  private running = false;
  private cancelled = false;
  private sealed = false;
  private cursor = 0;
  private urls = new Map<string, string>();
  private inFlight = new Set<AbortController>();
  private mintQueue: MintRequest[] = [];
  private mintTimer: ReturnType<typeof setTimeout> | null = null;
  private samples: { t: number; bytes: number }[] = [];
  private lastEmit = 0;

  constructor(
    tasks: DownloadTask[],
    private readonly sink: DownloadSink,
    private readonly opts: DownloadOptions,
  ) {
    this.tasks = tasks;
  }

  snapshot(): DownloadSnapshot {
    let totalBytes = 0;
    let receivedBytes = 0;
    let doneCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    for (const t of this.tasks) {
      totalBytes += t.size;
      receivedBytes += t.received;
      if (t.status === "done") {
        doneCount++;
        if (t.preexisting) skippedCount++;
      }
      if (t.status === "error") errorCount++;
    }
    const bps = this.throughput();
    const remaining = totalBytes - receivedBytes;
    return {
      tasks: this.tasks,
      totalBytes,
      receivedBytes,
      doneCount,
      skippedCount,
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

  private emit(force = false) {
    const now = Date.now();
    if (!force && now - this.lastEmit < EMIT_INTERVAL_MS) return;
    this.lastEmit = now;
    const snapshot = this.snapshot();
    this.samples.push({ t: now, bytes: snapshot.receivedBytes });
    this.opts.onChange(snapshot);
  }

  start() {
    if (this.running || this.sealed || this.cancelled) return;
    this.running = true;
    this.cursor = 0;
    for (const t of this.tasks) {
      if (t.status === "error") {
        t.status = "pending";
        t.error = undefined;
        t.received = 0;
        t.attempts = 0;
      }
    }
    const workers = Array.from(
      {
        length: Math.max(
          1,
          Math.min(this.opts.concurrency, this.sink.concurrency),
        ),
      },
      () => this.worker(),
    );
    void Promise.all(workers).finally(() => {
      this.running = false;
      void this.settle();
    });
    this.emit(true);
  }

  // A zip is only a valid archive once its central directory is written, so the
  // run has to be closed the moment the last worker stops — not when the user
  // dismisses the tray. That also spends the sink: only a destination that keeps
  // what it already holds can be started again to retry what failed.
  private async settle() {
    if (this.cancelled || this.sealed) {
      this.emit(true);
      return;
    }
    if (this.sink.resumable && this.tasks.some((t) => t.status === "pending")) {
      this.emit(true);
      return;
    }
    if (!this.sink.resumable) this.sealed = true;
    let error: string | null = null;
    try {
      await this.sink.close();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    this.emit(true);
    this.opts.onClosed?.(error);
  }

  pause() {
    this.running = false;
    for (const controller of this.inFlight) controller.abort();
    this.inFlight.clear();
  }

  async cancel() {
    this.cancelled = true;
    this.pause();
    await this.sink.discard();
    this.emit(true);
  }

  private nextTask(): DownloadTask | null {
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
      task.status = "downloading";
      task.received = 0;
      this.emit();
      try {
        if (await this.sink.alreadyHave(task)) {
          task.preexisting = true;
        } else {
          await this.fetchOne(task);
        }
        task.status = "done";
        task.received = task.size;
      } catch (err) {
        if (
          !this.running &&
          err instanceof DOMException &&
          err.name === "AbortError"
        ) {
          task.status = "pending";
          task.received = 0;
        } else {
          task.status = "error";
          task.received = 0;
          task.error = err instanceof Error ? err.message : String(err);
        }
      }
      this.emit();
    }
  }

  private async fetchOne(task: DownloadTask) {
    for (let attempt = task.attempts; attempt < MAX_ATTEMPTS; attempt++) {
      if (!this.running) throw new DOMException("aborted", "AbortError");
      try {
        await this.transfer(task);
        return;
      } catch (err) {
        task.attempts = attempt + 1;
        task.received = 0;
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        if (err instanceof HttpError) {
          // A signature that has aged out reads as 403; drop it and sign again.
          if (err.status === 403) this.urls.delete(task.key);
          else if (
            err.status >= 400 &&
            err.status < 500 &&
            err.status !== 408 &&
            err.status !== 429
          ) {
            throw err;
          }
        }
        if (attempt + 1 >= MAX_ATTEMPTS) throw err;
        await sleep(
          Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500,
        );
      }
    }
  }

  private async transfer(task: DownloadTask) {
    let url = this.urls.get(task.key);
    if (!url) {
      url = await this.mint(task);
      this.urls.set(task.key, url);
    }

    const controller = new AbortController();
    this.inFlight.add(controller);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok)
        throw new HttpError(res.status, (await res.text()).slice(0, 300));
      if (!res.body) throw new Error("response carried no body");
      await this.sink.write(task, res.body, (received) => {
        task.received = received;
        this.emit();
      });
    } finally {
      this.inFlight.delete(controller);
    }
  }

  private mint(task: DownloadTask): Promise<string> {
    return new Promise((resolve, reject) => {
      this.mintQueue.push({ task, resolve, reject });
      if (this.mintQueue.length >= MINT_BATCH) {
        void this.flushMint();
      } else if (!this.mintTimer) {
        this.mintTimer = setTimeout(
          () => void this.flushMint(),
          MINT_DEBOUNCE_MS,
        );
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
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: batch.map((b) => b.task.key) }),
      });
      if (!res.ok)
        throw new Error(
          `sign ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      const { grants } = (await res.json()) as { grants: ReadGrant[] };
      const byKey = new Map(grants.map((g) => [g.key, g]));
      for (const item of batch) {
        const grant = byKey.get(item.task.key);
        if (grant?.url) item.resolve(grant.url);
        else item.reject(new Error(grant?.error ?? "no link returned"));
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const item of batch) item.reject(error);
    }
  }
}
