import type { AfterRunResult } from "@exp-loop/core";

export interface SessionMessage {
  role: "user" | "assistant" | "tool_use" | "tool_result" | "system";
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  timestamp?: string;
}

export interface Session {
  id: string;
  source: string;
  projectPath?: string;
  title?: string;
  messages: SessionMessage[];
  startedAt: string;
  endedAt: string;
  metadata?: Record<string, unknown>;
  /** 0-based line index (inclusive) where parsed messages started */
  messagesStartLine?: number;
  /** 0-based line index (exclusive) marking end of parsed region = total lines consumed */
  messagesEndLine?: number;
}

export interface ListSessionsOpts {
  after?: string;
  projectPath?: string;
  limit?: number;
}

export interface ParseSessionOpts {
  /** 0-based JSONL line index to start parsing from (for incremental processing). */
  startLine?: number;
}

export interface SessionRef {
  id: string;
  path: string;
  projectPath?: string;
  title?: string;
  startedAt?: string;
  endedAt?: string;
  /** File last-modified time in ms since epoch (for incremental idle gating). */
  mtimeMs?: number;
  /** Total JSONL line count (for incremental accumulation gating). */
  lineCount?: number;
}

export interface IngestSource {
  name: string;
  /** Whether this source supports incremental parsing (delta from a line offset). */
  supportsIncremental?: boolean;
  listSessions(opts?: ListSessionsOpts): Promise<SessionRef[]>;
  parseSession(ref: SessionRef, opts?: ParseSessionOpts): Promise<Session>;
}

export interface ObserverCallbacks {
  onSessionStart?: (ref: SessionRef) => void;
  onSessionComplete?: (ref: SessionRef, result: AfterRunResult) => void;
  onSessionError?: (ref: SessionRef, error: Error) => void;
  /** A delta session was seen but did not pass the incremental gate (too recent / too small). */
  onSessionDeferred?: (ref: SessionRef, reason: string) => void;
}

/**
 * Dual-threshold gate for incremental extraction. A delta is only processed when BOTH
 * conditions hold — this prevents burning LLM calls on every few lines of an active
 * conversation. Both default to Infinity-safe values (disabled) when omitted.
 */
export interface IncrementalGate {
  /** Min ms since the session file was last modified (default: 120000 = 2min). */
  idleMs?: number;
  /** Min number of new lines since last processing (default: 30). */
  minDeltaLines?: number;
}

export interface ObserverConfig {
  source: IngestSource;
  dataDir: string;
  llm: (prompt: string) => Promise<string>;
  callbacks?: ObserverCallbacks;
  /** Dual-threshold gate for incremental delta extraction. */
  incrementalGate?: IncrementalGate;
}

export interface ObserveResult {
  sessionsProcessed: number;
  episodesCreated: number;
  experiencesExtracted: number;
  errors: { sessionId: string; error: string }[];
}
