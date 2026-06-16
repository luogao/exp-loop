export type {
  Session,
  SessionMessage,
  IngestSource,
  ListSessionsOpts,
  SessionRef,
  ObserverConfig,
  ObserverCallbacks,
  ObserveResult,
} from "./types.js";

export { createScheduler } from "./scheduler.js";
export type { SchedulerConfig, SchedulerState, TriggerConfig } from "./scheduler.js";

export { createFileWatcher } from "./file-watcher.js";
export type { FileWatcherConfig } from "./file-watcher.js";

export {
  loadState,
  saveState,
  getProjectState,
  getOrCreateProjectState,
  shouldProcessSession,
  getUnprocessedSessions,
  markSessionProcessed,
  markSessionsProcessed,
  recordError,
  updateLastChecked,
  normalizeProjectPath,
} from "./state-manager.js";
export type { ObserverState, ProjectState } from "./state-manager.js";

export { ClaudeCodeIngestSource } from "./sources/claude-code.js";
export { CodexIngestSource } from "./sources/codex.js";
export { GeminiIngestSource } from "./sources/gemini.js";
export { HermesIngestSource } from "./sources/hermes.js";
export { createSessionMapper } from "./session-mapper.js";
export { createObserver } from "./observer.js";
