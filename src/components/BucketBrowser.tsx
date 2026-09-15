"use client";

import {
  ChevronRight,
  Download,
  File as FileIcon,
  FolderDown,
  Folder,
  FolderPlus,
  HardDriveDownload,
  Link2,
  Lock,
  MoreHorizontal,
  RefreshCw,
  Search,
  Upload,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DownloadTray } from "@/components/DownloadTray";
import { UploadTray } from "@/components/UploadTray";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DownloadEngine } from "@/download/engine";
import { listFolder, tasksFor } from "@/download/manifest";
import {
  blobBytes,
  DirectorySink,
  fileStreamBytes,
  ZipSink,
  type DownloadSink,
} from "@/download/sink";
import type { DownloadSnapshot, RemoteObject } from "@/download/types";
import { formatBytes, formatWhen } from "@/lib/format";
import { UploadEngine } from "@/upload/engine";
import {
  scanDirectoryHandle,
  sourcesFromDataTransfer,
  sourcesFromInput,
  supportsDirectoryPicker,
} from "@/upload/scan";
import type { FileSource, FileTask, Snapshot } from "@/upload/types";

interface Entry {
  name: string;
  key: string;
  size: number;
  updated: string | null;
  contentType: string;
}

interface Listing {
  root: string;
  prefix: string;
  writable: boolean;
  folders: { name: string; prefix: string }[];
  files: Entry[];
  nextPageToken: string | null;
}

async function listRemoteSizes(prefix: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let pageToken: string | null = null;
  do {
    const res = await fetch("/api/upload/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix, pageToken }),
    });
    if (!res.ok) throw new Error(`listing failed (${res.status})`);
    const data = (await res.json()) as {
      items: { path: string; size: number }[];
      nextPageToken: string | null;
    };
    for (const i of data.items) out.set(i.path, i.size);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

export default function BucketBrowser({ root }: { root: string }) {
  const [prefix, setPrefix] = useState(`${root}/`);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [dragging, setDragging] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [canPickDirectory, setCanPickDirectory] = useState(false);
  const [download, setDownload] = useState<DownloadSnapshot | null>(null);
  const [downloadTo, setDownloadTo] = useState({ label: "", resumable: true });
  const [folderTarget, setFolderTarget] = useState<string | null>(null);
  const [scan, setScan] = useState({ count: 0, bytes: 0, done: false });

  const engineRef = useRef<UploadEngine | null>(null);
  const downloadRef = useRef<DownloadEngine | null>(null);
  const manifest = useRef<RemoteObject[]>([]);
  const scanCancelled = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => setCanPickDirectory(supportsDirectoryPicker()), []);

  const load = useCallback(async (target: string, pageToken?: string) => {
    if (pageToken) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/browse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefix: target, pageToken }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error ?? `browse ${res.status}`);
      const data = (await res.json()) as Listing;
      setListing((prev) =>
        pageToken && prev
          ? {
              ...data,
              folders: [...prev.folders, ...data.folders],
              files: [...prev.files, ...data.files],
            }
          : data,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(prefix);
  }, [prefix, load]);

  useEffect(() => {
    if (!snapshot?.running && !download?.running) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [snapshot?.running, download?.running]);

  const crumbs = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean);
    return parts.map((name, i) => ({
      name,
      prefix: parts.slice(0, i + 1).join("/") + "/",
    }));
  }, [prefix]);

  const filtered = useMemo(() => {
    if (!listing) return { folders: [], files: [] };
    const q = filter.trim().toLowerCase();
    if (!q) return { folders: listing.folders, files: listing.files };
    return {
      folders: listing.folders.filter((f) => f.name.toLowerCase().includes(q)),
      files: listing.files.filter((f) => f.name.toLowerCase().includes(q)),
    };
  }, [listing, filter]);

  async function beginUpload(sources: FileSource[]) {
    if (sources.length === 0) return;
    if (!listing?.writable) {
      toast.error("This folder is read-only", {
        description: `Uploads are only allowed under ${root}/`,
      });
      return;
    }

    setPreparing("Checking what is already here…");
    let remote: Map<string, number>;
    try {
      remote = await listRemoteSizes(prefix);
    } catch (err) {
      setPreparing(null);
      toast.error("Could not read the destination", {
        description: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    setPreparing(null);

    const tasks: FileTask[] = sources.map((s) => {
      const existing = remote.get(s.relPath);
      if (existing === s.size) {
        return {
          relPath: s.relPath,
          size: s.size,
          uploaded: s.size,
          status: "done",
          attempts: 0,
          preexisting: true,
        };
      }
      // A differing size means the local copy is newer; the service account can
      // overwrite, so this uploads rather than stalling as a conflict.
      return {
        relPath: s.relPath,
        size: s.size,
        uploaded: 0,
        status: "pending",
        attempts: 0,
      };
    });

    const engine = new UploadEngine(sources, tasks, {
      jobId: prefix,
      prefix,
      concurrency: 4,
      chunkSize: 16 * 1024 * 1024,
      onChange: setSnapshot,
    });
    engineRef.current = engine;
    engine.start();
  }

  async function pickFolder() {
    try {
      const handle = await window.showDirectoryPicker!({
        id: "geoid-upload",
        mode: "read",
      });
      setPreparing("Scanning folder…");
      const sources = await scanDirectoryHandle(handle, (n) =>
        setPreparing(`Scanning folder… ${n.toLocaleString()} files`),
      );
      setPreparing(null);
      await beginUpload(sources);
    } catch (err) {
      setPreparing(null);
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    setPreparing("Reading dropped items…");
    try {
      const sources = await sourcesFromDataTransfer(e.dataTransfer);
      setPreparing(null);
      await beginUpload(sources);
    } catch (err) {
      setPreparing(null);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function openFile(key: string, disposition: "inline" | "attachment") {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, disposition }),
    });
    if (!res.ok) {
      toast.error("Could not create a link");
      return;
    }
    const { url, expiresInMinutes } = (await res.json()) as {
      url: string;
      expiresInMinutes: number;
    };
    if (disposition === "attachment") {
      // One object goes straight to the browser's own download manager: it survives
      // this tab closing and needs no write permission to the filesystem.
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied", {
        description: `Expires in ${expiresInMinutes} minutes.`,
      });
    }
  }

  async function prepareFolderDownload(target: string) {
    if (download?.running) {
      toast.error("A download is already running", {
        description: "Wait for it to finish, or cancel it first.",
      });
      return;
    }
    scanCancelled.current = false;
    manifest.current = [];
    setScan({ count: 0, bytes: 0, done: false });
    setFolderTarget(target);
    try {
      const found = await listFolder(
        target,
        (count, bytes) => setScan({ count, bytes, done: false }),
        () => scanCancelled.current,
      );
      manifest.current = found;
      setScan({
        count: found.length,
        bytes: found.reduce((sum, f) => sum + f.size, 0),
        done: true,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setFolderTarget(null);
      toast.error("Could not read that folder", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function startFolderDownload(mode: "folder" | "zip") {
    const target = folderTarget;
    const items = manifest.current;
    if (!target || items.length === 0) return;
    const name = target.split("/").filter(Boolean).pop() ?? "geoid";

    let sink: DownloadSink;
    try {
      if (mode === "folder") {
        const handle = await window.showDirectoryPicker!({
          id: "geoid-download",
          mode: "readwrite",
        });
        sink = new DirectorySink(handle);
      } else if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          id: "geoid-download-zip",
          suggestedName: `${name}.zip`,
          types: [
            {
              description: "Zip archive",
              accept: { "application/zip": [".zip"] },
            },
          ],
        });
        sink = new ZipSink(
          `${name}.zip`,
          fileStreamBytes(await handle.createWritable()),
        );
      } else {
        sink = new ZipSink(`${name}.zip`, blobBytes(`${name}.zip`));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Could not open that destination", {
        description: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    setFolderTarget(null);
    setDownloadTo({ label: sink.label, resumable: sink.resumable });
    const engine = new DownloadEngine(tasksFor(items), sink, {
      concurrency: 4,
      onChange: setDownload,
      onClosed: (error) => {
        if (error)
          toast.error("Could not finish the download", { description: error });
      },
    });
    downloadRef.current = engine;
    engine.start();
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    const res = await fetch("/api/folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix, name }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error("Could not create folder", { description: data.error });
      return;
    }
    setNewFolderOpen(false);
    setNewFolderName("");
    toast.success(
      data.created ? `Created ${name}/` : `${name}/ already exists`,
    );
    void load(prefix);
  }

  const readOnly = listing != null && !listing.writable;

  return (
    <div
      className="flex min-h-screen flex-col"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-3">
          <h1 className="text-sm font-semibold">GEOID Storage</h1>
          <div className="ml-auto flex items-center gap-2">
            <form
              action="/api/session"
              method="post"
              onSubmit={async (e) => {
                e.preventDefault();
                await fetch("/api/session", { method: "DELETE" });
                location.reload();
              }}
            >
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <nav
          aria-label="Breadcrumb"
          className="mb-4 flex flex-wrap items-center gap-1 text-sm"
        >
          <button
            onClick={() => setPrefix("")}
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Home
          </button>
          {crumbs.map((c, i) => (
            <span key={c.prefix} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-muted-foreground/50" />
              <button
                onClick={() => setPrefix(c.prefix)}
                className={
                  i === crumbs.length - 1
                    ? "rounded px-1.5 py-0.5 font-medium"
                    : "rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                }
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter loaded items"
              className="pl-8"
              aria-label="Filter items in this folder"
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => void load(prefix)}
            aria-label="Refresh"
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>

          <Button
            variant="outline"
            disabled={!prefix}
            onClick={() => void prepareFolderDownload(prefix)}
          >
            <FolderDown className="size-4" />
            Download folder
          </Button>

          <Button
            variant="outline"
            disabled={readOnly}
            onClick={() => setNewFolderOpen(true)}
          >
            <FolderPlus className="size-4" />
            New folder
          </Button>

          {readOnly ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled>
                    <Lock className="size-4" />
                    Upload
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Uploads are only allowed under <code>{root}/</code>
              </TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Upload className="size-4" />
                  Upload
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => fileInputRef.current?.click()}
                >
                  Files…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    canPickDirectory
                      ? void pickFolder()
                      : folderInputRef.current?.click()
                  }
                >
                  Folder…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files)
              void beginUpload(sourcesFromInput(e.target.files));
            e.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files)
              void beginUpload(sourcesFromInput(e.target.files));
            e.target.value = "";
          }}
        />

        {readOnly && (
          <Alert className="mb-4">
            <Lock className="size-4" />
            <AlertTitle>Read-only area</AlertTitle>
            <AlertDescription>
              This is shared pipeline data. You can browse and download here,
              but new files can only be written under <code>{root}/</code>.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Could not list this folder</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {preparing && (
          <Alert className="mb-4">
            <AlertDescription>{preparing}</AlertDescription>
          </Alert>
        )}

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-28 text-right">Size</TableHead>
                <TableHead className="w-32">Modified</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!loading && prefix !== "" && (
                <TableRow
                  className="cursor-pointer"
                  onClick={() =>
                    setPrefix(
                      prefix.split("/").filter(Boolean).slice(0, -1).join("/") +
                        "/",
                    )
                  }
                >
                  <TableCell colSpan={4} className="text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Folder className="size-4" />
                      ..
                    </span>
                  </TableCell>
                </TableRow>
              )}

              {!loading &&
                filtered.folders.map((f) => (
                  <TableRow
                    key={f.prefix}
                    className="cursor-pointer"
                    onClick={() => setPrefix(f.prefix)}
                  >
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        {f.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      —
                    </TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Download ${f.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void prepareFolderDownload(f.prefix);
                        }}
                      >
                        <FolderDown className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}

              {!loading &&
                filtered.files.map((f) => (
                  <TableRow key={f.key}>
                    <TableCell className="max-w-0">
                      <span className="flex items-center gap-2">
                        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate" title={f.name}>
                          {f.name}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatBytes(f.size)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatWhen(f.updated)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Download ${f.name}`}
                          onClick={() => void openFile(f.key, "attachment")}
                        >
                          <Download className="size-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${f.name}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                void openFile(f.key, "attachment")
                              }
                            >
                              <Download className="size-4" />
                              Download
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void openFile(f.key, "inline")}
                            >
                              <Link2 className="size-4" />
                              Copy link
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

              {!loading &&
                filtered.folders.length === 0 &&
                filtered.files.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-14 text-center text-muted-foreground"
                    >
                      {filter
                        ? "Nothing matches that filter."
                        : "This folder is empty."}
                    </TableCell>
                  </TableRow>
                )}
            </TableBody>
          </Table>
        </div>

        {listing?.nextPageToken && (
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              disabled={loadingMore}
              onClick={() => void load(prefix, listing.nextPageToken!)}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          {listing
            ? `${listing.folders.length} folders, ${listing.files.length} files loaded${
                listing.nextPageToken ? " (more available)" : ""
              }`
            : ""}
        </p>
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/85">
          <div className="rounded-xl border-2 border-dashed px-10 py-8 text-center">
            <UploadCloud className="mx-auto mb-3 size-9 text-muted-foreground" />
            <p className="font-medium">
              {readOnly
                ? "This folder is read-only"
                : "Drop files or folders to upload"}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {prefix || "Home"}
            </p>
          </div>
        </div>
      )}

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {prefix}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createFolder();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
                value={newFolderName}
                autoFocus
                autoComplete="off"
                onChange={(e) => setNewFolderName(e.target.value)}
              />
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewFolderOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!newFolderName.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={folderTarget !== null}
        onOpenChange={(open) => {
          if (open) return;
          scanCancelled.current = true;
          setFolderTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Download folder</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {folderTarget}
            </DialogDescription>
          </DialogHeader>

          {!scan.done ? (
            <p className="text-sm text-muted-foreground">
              Listing everything underneath…{" "}
              <span className="tabular-nums">
                {scan.count.toLocaleString()} files, {formatBytes(scan.bytes)}
              </span>
            </p>
          ) : scan.count === 0 ? (
            <p className="text-sm text-muted-foreground">
              This folder holds no files.
            </p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm">
                <span className="font-medium tabular-nums">
                  {scan.count.toLocaleString()} files ·{" "}
                  {formatBytes(scan.bytes)}
                </span>{" "}
                including everything in sub-folders.
              </p>

              <div className="space-y-2">
                {canPickDirectory && (
                  <button
                    onClick={() => void startFolderDownload("folder")}
                    className="flex w-full items-start gap-3 rounded-lg border p-3 text-left hover:bg-muted"
                  >
                    <HardDriveDownload className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block text-sm font-medium">
                        Save into a folder
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Writes straight to disk, keeping the tree. Pick the same
                        folder again later and files already there are skipped.
                      </span>
                    </span>
                  </button>
                )}

                <button
                  onClick={() => void startFolderDownload("zip")}
                  className="flex w-full items-start gap-3 rounded-lg border p-3 text-left hover:bg-muted"
                >
                  <FolderDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block text-sm font-medium">
                      Download as one .zip
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Stored, not compressed, so it is roughly{" "}
                      {formatBytes(scan.bytes)}. It is built in order and cannot
                      be paused.
                    </span>
                  </span>
                </button>
              </div>

              {!canPickDirectory && scan.bytes > 2 * 1024 ** 3 && (
                <Alert variant="destructive">
                  <AlertTitle>That is a lot for this browser</AlertTitle>
                  <AlertDescription>
                    Without the File System Access API the archive is held by
                    the browser until it is complete. Chrome or Edge can write
                    it straight to disk instead.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                scanCancelled.current = true;
                setFolderTarget(null);
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(download || snapshot) && (
        <div className="fixed bottom-4 right-4 z-50 flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-3">
          {download && (
            <DownloadTray
              snapshot={download}
              destination={downloadTo.label}
              resumable={downloadTo.resumable}
              onPause={() => downloadRef.current?.pause()}
              onResume={() => downloadRef.current?.start()}
              onCancel={() => {
                void downloadRef.current?.cancel();
                setDownload(null);
              }}
              onDismiss={() => setDownload(null)}
            />
          )}

          {snapshot && (
            <UploadTray
              snapshot={snapshot}
              destination={prefix}
              onPause={() => engineRef.current?.pause()}
              onResume={() => engineRef.current?.start()}
              onDismiss={() => {
                setSnapshot(null);
                void load(prefix);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
