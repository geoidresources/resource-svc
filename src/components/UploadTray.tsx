"use client";

import { ChevronDown, ChevronUp, Pause, Play, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, formatDuration } from "@/lib/format";
import type { Snapshot } from "@/upload/types";

interface Props {
  snapshot: Snapshot;
  destination: string;
  onPause: () => void;
  onResume: () => void;
  onDismiss: () => void;
}

export function UploadTray({ snapshot, destination, onPause, onResume, onDismiss }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const pct =
    snapshot.totalBytes > 0 ? (snapshot.uploadedBytes / snapshot.totalBytes) * 100 : 0;
  const active = snapshot.tasks.filter((t) => t.status === "uploading");
  const problems = snapshot.tasks.filter(
    (t) => t.status === "error" || t.status === "conflict",
  );
  const finished = !snapshot.running && snapshot.doneCount === snapshot.tasks.length;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-2xl">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {finished
              ? "Upload complete"
              : snapshot.running
                ? `Uploading ${snapshot.doneCount + 1} of ${snapshot.tasks.length}`
                : "Upload paused"}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">{destination}</p>
        </div>

        {!finished &&
          (snapshot.running ? (
            <Button size="icon" variant="ghost" onClick={onPause} aria-label="Pause upload">
              <Pause className="size-4" />
            </Button>
          ) : (
            <Button size="icon" variant="ghost" onClick={onResume} aria-label="Resume upload">
              <Play className="size-4" />
            </Button>
          ))}

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>

        {!snapshot.running && (
          <Button size="icon" variant="ghost" onClick={onDismiss} aria-label="Dismiss">
            <X className="size-4" />
          </Button>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        <Progress value={pct} aria-label="Overall upload progress" />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {formatBytes(snapshot.uploadedBytes)} / {formatBytes(snapshot.totalBytes)}
          </span>
          <span className="tabular-nums">
            {snapshot.running
              ? `${formatBytes(snapshot.bytesPerSecond)}/s · ${formatDuration(snapshot.etaSeconds)} left`
              : `${snapshot.doneCount}/${snapshot.tasks.length} files`}
          </span>
        </div>

        {(snapshot.skippedCount > 0 || problems.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {snapshot.skippedCount > 0 && (
              <Badge variant="secondary">{snapshot.skippedCount} already present</Badge>
            )}
            {snapshot.conflictCount > 0 && (
              <Badge variant="destructive">{snapshot.conflictCount} cannot overwrite</Badge>
            )}
            {snapshot.errorCount > 0 && (
              <Badge variant="destructive">{snapshot.errorCount} failed</Badge>
            )}
          </div>
        )}
      </div>

      {!collapsed && (active.length > 0 || problems.length > 0) && (
        <ScrollArea className="max-h-56 border-t">
          <div className="divide-y">
            {active.map((t) => (
              <div key={t.relPath} className="flex items-center gap-3 px-4 py-2">
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs"
                  dir="rtl"
                  title={t.relPath}
                >
                  {t.relPath}
                </span>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {t.size > 0 ? Math.floor((t.uploaded / t.size) * 100) : 100}%
                </span>
              </div>
            ))}
            {problems.slice(0, 50).map((t) => (
              <div key={t.relPath} className="px-4 py-2">
                <p className="truncate font-mono text-xs" dir="rtl" title={t.relPath}>
                  {t.relPath}
                </p>
                <p className="text-xs text-destructive">{t.error}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
