"use client";

import { ChevronDown, ChevronUp, Pause, Play, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DownloadSnapshot } from "@/download/types";
import { formatBytes, formatDuration } from "@/lib/format";

interface Props {
  snapshot: DownloadSnapshot;
  destination: string;
  resumable: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}

export function DownloadTray({
  snapshot,
  destination,
  resumable,
  onPause,
  onResume,
  onCancel,
  onDismiss,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const pct =
    snapshot.totalBytes > 0
      ? (snapshot.receivedBytes / snapshot.totalBytes) * 100
      : 0;
  const active = snapshot.tasks.filter((t) => t.status === "downloading");
  const problems = snapshot.tasks.filter((t) => t.status === "error");
  const settled =
    !snapshot.running && !snapshot.tasks.some((t) => t.status === "pending");

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-2xl">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {settled
              ? problems.length > 0
                ? "Download finished with errors"
                : "Download complete"
              : snapshot.running
                ? `Downloading ${Math.min(snapshot.doneCount + 1, snapshot.tasks.length)} of ${snapshot.tasks.length}`
                : "Download paused"}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {destination}
          </p>
        </div>

        {settled && resumable && problems.length > 0 && (
          <Button size="sm" variant="outline" onClick={onResume}>
            <RotateCw className="size-4" />
            Retry {problems.length}
          </Button>
        )}

        {!settled &&
          resumable &&
          (snapshot.running ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={onPause}
              aria-label="Pause download"
            >
              <Pause className="size-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              onClick={onResume}
              aria-label="Resume download"
            >
              <Play className="size-4" />
            </Button>
          ))}

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={settled ? onDismiss : onCancel}
          aria-label={settled ? "Dismiss" : "Cancel download"}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="space-y-3 px-4 py-3">
        <Progress value={pct} aria-label="Overall download progress" />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {formatBytes(snapshot.receivedBytes)} /{" "}
            {formatBytes(snapshot.totalBytes)}
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
              <Badge variant="secondary">
                {snapshot.skippedCount} already on disk
              </Badge>
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
              <div key={t.key} className="flex items-center gap-3 px-4 py-2">
                <span
                  className="min-w-0 flex-1 truncate font-mono text-xs"
                  dir="rtl"
                  title={t.path}
                >
                  {t.path}
                </span>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {t.size > 0 ? Math.floor((t.received / t.size) * 100) : 100}%
                </span>
              </div>
            ))}
            {problems.slice(0, 50).map((t) => (
              <div key={t.key} className="px-4 py-2">
                <p
                  className="truncate font-mono text-xs"
                  dir="rtl"
                  title={t.path}
                >
                  {t.path}
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
