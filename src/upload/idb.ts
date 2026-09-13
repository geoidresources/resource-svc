import type { FileTask } from "./types";

const DB_NAME = "geoid-uploader";
const DB_VERSION = 1;
const JOBS = "jobs";
const TASKS = "tasks";

export interface JobRecord {
  id: string;
  destPrefix: string;
  createdAt: number;
  dirHandle?: FileSystemDirectoryHandle;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TASKS)) {
        const store = db.createObjectStore(TASKS, { keyPath: ["jobId", "relPath"] });
        store.createIndex("jobId", "jobId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveJob(job: JobRecord): Promise<void> {
  const db = await open();
  const tx = db.transaction(JOBS, "readwrite");
  tx.objectStore(JOBS).put(job);
  await done(tx);
  db.close();
}

export async function listJobs(): Promise<JobRecord[]> {
  const db = await open();
  const tx = db.transaction(JOBS, "readonly");
  const req = tx.objectStore(JOBS).getAll();
  await done(tx);
  db.close();
  return (req.result as JobRecord[]).sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveTasks(jobId: string, tasks: FileTask[]): Promise<void> {
  const db = await open();
  const tx = db.transaction(TASKS, "readwrite");
  const store = tx.objectStore(TASKS);
  for (const t of tasks) store.put({ jobId, ...t });
  await done(tx);
  db.close();
}

export async function loadTasks(jobId: string): Promise<FileTask[]> {
  const db = await open();
  const tx = db.transaction(TASKS, "readonly");
  const req = tx.objectStore(TASKS).index("jobId").getAll(jobId);
  await done(tx);
  db.close();
  return (req.result as (FileTask & { jobId: string })[]).map(({ jobId: _j, ...t }) => t);
}

export async function deleteJob(jobId: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([JOBS, TASKS], "readwrite");
  tx.objectStore(JOBS).delete(jobId);
  const index = tx.objectStore(TASKS).index("jobId");
  const cursorReq = index.openCursor(IDBKeyRange.only(jobId));
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await done(tx);
  db.close();
}
