import type { FileSource } from "./types";

const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".localized"]);
const IGNORED_DIRS = new Set([".git", ".svn", "__MACOSX", ".Trashes", ".Spotlight-V100"]);

function ignored(name: string): boolean {
  return IGNORED_NAMES.has(name) || name.startsWith("._");
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function scanDirectoryHandle(
  root: FileSystemDirectoryHandle,
  onProgress?: (count: number) => void,
): Promise<FileSource[]> {
  const out: FileSource[] = [];

  async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
    for await (const [name, handle] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      if (handle.kind === "directory") {
        if (IGNORED_DIRS.has(name)) continue;
        await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
        continue;
      }
      if (ignored(name)) continue;
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      out.push({
        relPath: `${prefix}${name}`,
        size: file.size,
        getFile: () => fileHandle.getFile(),
      });
      if (out.length % 250 === 0) onProgress?.(out.length);
    }
  }

  await walk(root, `${root.name}/`);
  onProgress?.(out.length);
  return out;
}

export function sourcesFromInput(list: FileList): FileSource[] {
  const out: FileSource[] = [];
  for (const file of Array.from(list)) {
    const relPath = file.webkitRelativePath || file.name;
    const segments = relPath.split("/");
    if (segments.some((s) => IGNORED_DIRS.has(s))) continue;
    if (ignored(segments[segments.length - 1])) continue;
    out.push({ relPath, size: file.size, getFile: async () => file });
  }
  return out;
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: FileSource[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((res, rej) => fileEntry.file(res, rej));
    if (ignored(file.name)) return;
    out.push({ relPath: `${prefix}${file.name}`, size: file.size, getFile: async () => file });
    return;
  }
  if (!entry.isDirectory || IGNORED_DIRS.has(entry.name)) return;

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    // readEntries yields at most 100 per call and signals the end with an
    // empty batch, so a single call silently truncates large directories.
    const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
      reader.readEntries(res, rej),
    );
    if (batch.length === 0) break;
    for (const child of batch) await walkEntry(child, `${prefix}${entry.name}/`, out);
  }
}

export async function sourcesFromDataTransfer(dt: DataTransfer): Promise<FileSource[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  const out: FileSource[] = [];
  for (const entry of entries) await walkEntry(entry, "", out);
  if (out.length > 0) return out;

  // webkitGetAsEntry yields null outside a genuine user drag in some browsers;
  // dt.files still carries the payload, minus any directory structure.
  return sourcesFromInput(dt.files);
}
