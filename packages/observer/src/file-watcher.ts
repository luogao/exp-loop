/**
 * File watcher for monitoring Claude Code session files (.jsonl).
 *
 * Uses chokidar for reliable cross-platform file watching with debouncing
 * to avoid processing partial writes.
 */

import { watch, FSWatcher } from "chokidar";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { stat } from "node:fs/promises";
import type { SessionRef } from "./types.js";

export interface FileWatcherConfig {
  /** Directory to watch (default: ~/.claude/projects) */
  projectsDir?: string;
  /** Callback when a session file is modified */
  onSessionModified?: (sessionRef: SessionRef) => void | Promise<void>;
  /** Callback when a new session file is created */
  onSessionCreated?: (sessionRef: SessionRef) => void | Promise<void>;
  /** Callback for errors */
  onError?: (error: Error) => void;
  /** Debounce delay in ms (default: 2000) */
  debounceDelay?: number;
  /** Filter by project path substring */
  projectPathFilter?: string[];
}

interface DebounceEntry {
  timer: NodeJS.Timeout;
  eventType: string;
}

/**
 * Read lightweight metadata from the head of a .jsonl session file.
 * Only reads the first ~2KB to keep it fast.
 */
async function readSessionMeta(filePath: string): Promise<{ cwd?: string; title?: string; startedAt?: string } | null> {
  try {
    const { open } = await import("node:fs/promises");
    const fh = await open(filePath, "r");
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(buf, 0, 4096, 0);
      const text = buf.toString("utf8", 0, bytesRead);

      let cwd: string | undefined;
      let title: string | undefined;
      let startedAt: string | undefined;

      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.timestamp && !startedAt) startedAt = entry.timestamp;
          if (entry.cwd && !cwd) cwd = entry.cwd;
          if (entry.type === "ai-title" && entry.title && !title) title = entry.title;
          if (entry.type === "custom-title" && entry.customTitle) title = entry.customTitle;
        } catch { /* skip */ }
      }
      return { cwd, title, startedAt };
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/**
 * Create a file watcher for Claude Code session files.
 *
 * Watches `~/.claude/projects` jsonl files for changes and triggers
 * callbacks when files are added or modified.
 */
export function createFileWatcher(config: FileWatcherConfig = {}) {
  const {
    projectsDir = join(homedir(), ".claude", "projects"),
    onSessionModified,
    onSessionCreated,
    onError,
    debounceDelay = 2000,
    projectPathFilter,
  } = config;

  let watcher: FSWatcher | null = null;
  let running = false;

  // Per-file debounce map: filePath → { timer, eventType }
  const pending = new Map<string, DebounceEntry>();

  // Per-file last-processed mtime to skip redundant fires
  const lastProcessedMtime = new Map<string, number>();

  function matchesFilter(cwd?: string): boolean {
    if (!projectPathFilter || projectPathFilter.length === 0) return true;
    if (!cwd) return false;
    return projectPathFilter.some((f) => cwd.includes(f));
  }

  /**
   * Flush a debounced file event.
   */
  async function flush(filePath: string, eventType: string): Promise<void> {
    try {
      const sessionId = basename(filePath, ".jsonl");
      if (sessionId.startsWith("agent-")) return;

      // Skip if we processed this file very recently (< debounceDelay)
      try {
        const st = await stat(filePath);
        const mtime = st.mtimeMs;
        const last = lastProcessedMtime.get(filePath) ?? 0;
        if (mtime - last < 500) return; // 500ms dedup window
        lastProcessedMtime.set(filePath, mtime);
      } catch {
        return; // file gone
      }

      const meta = await readSessionMeta(filePath);
      if (!meta) return;
      if (!matchesFilter(meta.cwd)) return;

      const ref: SessionRef = {
        id: sessionId,
        path: filePath,
        projectPath: meta.cwd,
        title: meta.title,
        startedAt: meta.startedAt,
      };

      if (eventType === "add" && onSessionCreated) {
        await onSessionCreated(ref);
      } else if (eventType === "change" && onSessionModified) {
        await onSessionModified(ref);
      }
    } catch (err) {
      onError?.(err as Error);
    }
  }

  /**
   * Debounce a file event.
   */
  function schedule(filePath: string, eventType: string): void {
    const existing = pending.get(filePath);
    if (existing) {
      clearTimeout(existing.timer);
      // Upgrade to "change" if it was "add" — first real write after creation
      if (eventType === "change") existing.eventType = "change";
    }

    const timer = setTimeout(() => {
      pending.delete(filePath);
      const type = pending.get(filePath)?.eventType ?? eventType;
      void flush(filePath, type);
    }, debounceDelay);

    pending.set(filePath, { timer, eventType });
  }

  async function start(): Promise<void> {
    if (running) return;
    running = true;

    watcher = watch(projectsDir, {
      persistent: true,
      ignoreInitial: true, // Don't fire for existing files
      depth: 99, // Watch all subdirectories
      ignored: [
        /agent-.*\.jsonl$/, // Ignore subagent transcripts
        "**/node_modules/**",
        "**/.git/**",
        // Only ignore files that are not .jsonl (directories pass through)
        (path) => {
          if (typeof path !== "string") return false;
          // Let directories pass — chokidar needs them to recurse
          if (!path.includes(".")) return false;
          // Ignore non-jsonl files
          return !path.endsWith(".jsonl");
        },
      ],
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 200,
      },
    });

    watcher
      .on("add", (path) => schedule(path, "add"))
      .on("change", (path) => schedule(path, "change"))
      .on("error", (err) => onError?.(err as Error));

    // Wait for ready
    await new Promise<void>((resolve) => {
      watcher!.on("ready", () => resolve());
    });
  }

  async function stop(): Promise<void> {
    if (!running) return;
    running = false;

    for (const { timer } of pending.values()) clearTimeout(timer);
    pending.clear();

    if (watcher) {
      await watcher.close();
      watcher = null;
    }
  }

  return { start, stop, running: () => running };
}
