/**
 * Scheduler RPC methods for api-server.
 *
 * Exposes start/stop/status to control the background file-watcher
 * that automatically collects and processes sessions.
 */

import type { MethodHandler } from "../server.js";
import type { AppConfig } from "../config.js";
import { createScheduler, type SchedulerState } from "@exp-loop/observer";
import { ClaudeCodeIngestSource } from "@exp-loop/observer";
import { createLlm } from "../llm.js";

/** Singleton scheduler instance — null when stopped */
let scheduler: ReturnType<typeof createScheduler> | null = null;
let schedulerState: SchedulerState | null = null;

export function schedulerMethods(
  getConfig: () => AppConfig,
  onConfigChange?: (cb: (cfg: AppConfig) => void) => void,
): Record<string, MethodHandler> {
  return {
    /**
     * Start the background scheduler (file-watch mode).
     * If already running, returns current status.
     */
    "scheduler.start": async (_params, emit) => {
      if (scheduler?.running()) {
        return { running: true, state: scheduler.getState() };
      }

      const cfg = getConfig();

      // Resolve LLM
      const llm = await createLlm(cfg, (status, detail) => {
        emit("scheduler.llmStatus", { status, detail });
      });

      // Create ingest source
      const source = new ClaudeCodeIngestSource(cfg.claudeProjectsDir);

      // Determine project filter from selectedProjects
      const projectFilter =
        cfg.selectedProjects && cfg.selectedProjects.length > 0
          ? cfg.selectedProjects
          : undefined;

      scheduler = createScheduler({
        source,
        dataDir: cfg.dataDir,
        llm,
        mode: "watch",
        selectedProjects: projectFilter,
        watcherConfig: {
          projectPathFilter: projectFilter,
        },
        observerCallbacks: {
          onSessionStart(ref) {
            emit("scheduler.sessionStart", { ref });
          },
          onSessionComplete(ref, result) {
            emit("scheduler.sessionComplete", {
              ref,
              result: {
                episodeId: result.episodeId,
                newExperiences: result.newExperiences.length,
              },
            });
          },
          onSessionError(ref, error) {
            emit("scheduler.sessionError", { ref, error: error.message });
          },
        },
        callbacks: {
          onProcessTriggered(reason) {
            emit("scheduler.processTriggered", { reason });
          },
          onCheckStart() {
            emit("scheduler.checkStart", {});
          },
          onCheckComplete(hasNew) {
            emit("scheduler.checkComplete", { hasNew });
          },
          onError(error) {
            emit("scheduler.error", { error: error.message });
          },
        },
      });

      // Start with timeout to avoid blocking if chokidar hangs
      const startPromise = scheduler.start();
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([startPromise, timeoutPromise]);

      schedulerState = scheduler.getState();

      return {
        running: scheduler.running(),
        state: schedulerState,
        selectedProjects: getConfig().selectedProjects ?? [],
      };
    },

    /**
     * Stop the background scheduler.
     */
    "scheduler.stop": async () => {
      if (scheduler) {
        await scheduler.stop();
        schedulerState = scheduler.getState();
        scheduler = null;
      }
      return { running: false, selectedProjects: getConfig().selectedProjects ?? [] };
    },

    /**
     * Get current scheduler status.
     */
    "scheduler.status": async () => {
      if (!scheduler) {
        return { running: false, selectedProjects: getConfig().selectedProjects ?? [] };
      }
      return {
        running: scheduler.running(),
        state: scheduler.getState(),
        selectedProjects: getConfig().selectedProjects ?? [],
      };
    },
  };
}
