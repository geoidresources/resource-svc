export type TaskStatus = "pending" | "uploading" | "done" | "error" | "conflict";

export interface FileSource {
  relPath: string;
  size: number;
  getFile: () => Promise<File>;
}

export interface FileTask {
  relPath: string;
  size: number;
  uploaded: number;
  status: TaskStatus;
  key?: string;
  sessionUri?: string;
  error?: string;
  attempts: number;
  preexisting?: boolean;
}

export interface Snapshot {
  tasks: FileTask[];
  totalBytes: number;
  uploadedBytes: number;
  doneCount: number;
  skippedCount: number;
  conflictCount: number;
  errorCount: number;
  running: boolean;
  bytesPerSecond: number;
  etaSeconds: number | null;
}

export interface Grant {
  path: string;
  key?: string;
  url?: string;
  headers?: Record<string, string>;
  error?: string;
}
