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
}

export interface ListSessionsOpts {
  after?: string;
  projectPath?: string;
  limit?: number;
}

export interface SessionRef {
  id: string;
  path: string;
  projectPath?: string;
  title?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface IngestSource {
  name: string;
  listSessions(opts?: ListSessionsOpts): Promise<SessionRef[]>;
  parseSession(ref: SessionRef): Promise<Session>;
}

export interface ObserverCallbacks {
  onSessionStart?: (ref: SessionRef) => void;
  onSessionComplete?: (ref: SessionRef, result: AfterRunResult) => void;
  onSessionError?: (ref: SessionRef, error: Error) => void;
}

export interface ObserverConfig {
  source: IngestSource;
  dataDir: string;
  llm: (prompt: string) => Promise<string>;
  callbacks?: ObserverCallbacks;
}

export interface ObserveResult {
  sessionsProcessed: number;
  episodesCreated: number;
  experiencesExtracted: number;
  errors: { sessionId: string; error: string }[];
}
