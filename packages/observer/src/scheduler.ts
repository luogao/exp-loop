/**
 * Auto-scheduler that uses file-watching to detect Claude Code session changes
 * and triggers experience extraction in near real-time.
 *
 * Two modes:
 * 1. **watch** (default) — uses chokidar to watch `~/.claude/projects` jsonl files
 * 2. **poll** — falls back to setInterval if file-watching is unavailable
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type {
  IngestSource,
  SessionRef,
  ObserverCallbacks,
  ObserveResult,
} from "./types.js";
import { createObserver } from "./observer.js";
import { createFileWatcher, type FileWatcherConfig } from "./file-watcher.js";

// ── Types ────────────────────────────────────────────────────────────

export interface TriggerConfig {
  /** Fallback poll interval in ms when not using file-watch (default: 60000) */
  checkInterval?: number;
  /** Token threshold to trigger processing */
  tokenThreshold?: number;
  /** Message count threshold to trigger processing */
  messageThreshold?: number;
}

export interface SchedulerState {
  lastCheckedAt: string;
  lastProcessedAt: string;
  /** Per-project last processed session ID */
  lastProcessedSessionIds: Record<string, string>;
  stats: {
    totalSessionsProcessed: number;
    totalExperiencesExtracted: number;
    totalChecksPerformed: number;
    totalErrors: number;
  };
}

export interface SchedulerConfig extends TriggerConfig {
  source: IngestSource;
  dataDir: string;
  llm: (prompt: string) => Promise<string>;
  statePath?: string;
  observerCallbacks?: ObserverCallbacks;
  /** "watch" (default) or "poll" */
  mode?: "watch" | "poll";
  /** File watcher options (only used when mode="watch") */
  watcherConfig?: Omit<FileWatcherConfig, "onSessionModified" | "onSessionCreated" | "onError">;
  callbacks?: {
    onCheckStart?: () => void;
    onCheckComplete?: (hasNew: boolean) => void;
    onProcessTriggered?: (reason: string) => void;
    onError?: (error: Error) => void;
  };
  /** Project paths to filter — only process sessions from these projects */
  selectedProjects?: string[];
}

// ── Implementation ───────────────────────────────────────────────────

export function createScheduler(config: SchedulerConfig) {
  const {
    source,
    dataDir,
    llm,
    checkInterval = 60000,
    tokenThreshold = 6000,
    messageThreshold = 50,
    statePath = join(dataDir || homedir(), "observer", "scheduler-state.json"),
    observerCallbacks = {},
    mode = "watch",
    watcherConfig,
    callbacks = {},
    selectedProjects,
  } = config;

  const observer = createObserver({ source, dataDir, llm, callbacks: observerCallbacks });

  let state: SchedulerState;
  let isRunning = false;
  let pollTimer: NodeJS.Timeout | null = null;

  // ── State persistence ────────────────────────────────────────────

  async function loadState(): Promise<SchedulerState> {
    try {
      const raw = await readFile(statePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      const init: SchedulerState = {
        lastCheckedAt: new Date(0).toISOString(),
        lastProcessedAt: new Date(0).toISOString(),
        lastProcessedSessionIds: {},
        stats: {
          totalSessionsProcessed: 0,
          totalExperiencesExtracted: 0,
          totalChecksPerformed: 0,
          totalErrors: 0,
        },
      };
      await persistState(init);
      return init;
    }
  }

  async function persistState(s: SchedulerState): Promise<void> {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(s, null, 2));
    state = s;
  }

  // ── Core processing ──────────────────────────────────────────────

  /**
   * Run observer.observe() for specific projects (or all if none specified) and update state.
   */
  async function processNewSessions(reason: string, projectPaths?: string[]): Promise<ObserveResult | null> {
    callbacks.onProcessTriggered?.(reason);

    try {
      let result: ObserveResult;

      if (projectPaths && projectPaths.length > 0) {
        // Observe each selected project individually
        const combined: ObserveResult = {
          sessionsProcessed: 0,
          episodesCreated: 0,
          experiencesExtracted: 0,
          errors: [],
        };
        for (const projectPath of projectPaths) {
          const r = await observer.observe({ projectPath });
          combined.sessionsProcessed += r.sessionsProcessed;
          combined.episodesCreated += r.episodesCreated;
          combined.experiencesExtracted += r.experiencesExtracted;
          combined.errors.push(...r.errors);
        }
        result = combined;
      } else {
        result = await observer.observe();
      }

      state.stats.totalSessionsProcessed += result.sessionsProcessed;
      state.stats.totalExperiencesExtracted += result.experiencesExtracted;
      state.stats.totalErrors += result.errors.length;
      state.stats.totalChecksPerformed++;

      if (result.sessionsProcessed > 0) {
        state.lastProcessedAt = new Date().toISOString();
      }

      state.lastCheckedAt = new Date().toISOString();
      await persistState(state);

      callbacks.onCheckComplete?.(result.sessionsProcessed > 0);
      return result;
    } catch (err) {
      state.stats.totalErrors++;
      await persistState(state);
      callbacks.onError?.(err as Error);
      return null;
    }
  }

  // ── Watch mode ───────────────────────────────────────────────────

  const watcher = createFileWatcher({
    ...watcherConfig,
    onSessionModified: async (ref: SessionRef) => {
      if (!isRunning) return;

      const key = ref.projectPath || "default";
      const lastId = state.lastProcessedSessionIds[key];

      // Only process if this is a new or updated session
      if (ref.id !== lastId) {
        const projects = selectedProjects && selectedProjects.length > 0
          ? selectedProjects
          : ref.projectPath ? [ref.projectPath] : undefined;
        await processNewSessions(`file changed: ${ref.id}`, projects);
      }
    },
    onSessionCreated: async (ref: SessionRef) => {
      if (!isRunning) return;
      const projects = selectedProjects && selectedProjects.length > 0
        ? selectedProjects
        : ref.projectPath ? [ref.projectPath] : undefined;
      await processNewSessions(`new session: ${ref.id}`, projects);
    },
    onError: (err: Error) => {
      callbacks.onError?.(err);
    },
  });

  // ── Poll mode ────────────────────────────────────────────────────

  async function pollCheck(): Promise<void> {
    if (!isRunning) return;
    callbacks.onCheckStart?.();

    try {
      // Determine which projects to observe
      const projectPaths = selectedProjects && selectedProjects.length > 0
        ? selectedProjects
        : undefined;

      // Let observer.observe() handle dedup internally — it tracks processed sessions
      await processNewSessions("poll: checking for new sessions", projectPaths);
    } catch (err) {
      state.stats.totalErrors++;
      await persistState(state);
      callbacks.onError?.(err as Error);
    }
  }

  // ── Public API ───────────────────────────────────────────────────

  async function start(): Promise<void> {
    if (isRunning) return;
    isRunning = true;
    state = await loadState();

    // Always do an initial check to catch up
    await pollCheck();

    if (mode === "watch") {
      try {
        await watcher.start();
      } catch (err) {
        // Fall back to poll if watch fails
        callbacks.onError?.(err as Error);
        pollTimer = setInterval(() => void pollCheck(), checkInterval);
      }
    } else {
      pollTimer = setInterval(() => void pollCheck(), checkInterval);
    }
  }

  async function stop(): Promise<void> {
    isRunning = false;

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    await watcher.stop();
  }

  async function checkNow(): Promise<ObserveResult> {
    const result = await processNewSessions("manual check");
    return result ?? await observer.observe();
  }

  function getState(): SchedulerState {
    return state;
  }

  function running(): boolean {
    return isRunning;
  }

  return { start, stop, checkNow, getState, running };
}
