export type DownloadStatus = "pending" | "downloading" | "done" | "error";

export interface RemoteObject {
  key: string;
  path: string;
  size: number;
  updated: string | null;
}

export interface DownloadTask extends RemoteObject {
  received: number;
  status: DownloadStatus;
  error?: string;
  attempts: number;
  preexisting?: boolean;
}

export interface DownloadSnapshot {
  tasks: DownloadTask[];
  totalBytes: number;
  receivedBytes: number;
  doneCount: number;
  skippedCount: number;
  errorCount: number;
  running: boolean;
  bytesPerSecond: number;
  etaSeconds: number | null;
}

export interface ReadGrant {
  key: string;
  url?: string;
  error?: string;
}
