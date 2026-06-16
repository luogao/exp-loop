/**
 * Enhanced state manager for tracking processed sessions with incremental indexes.
 *
 * This replaces the simple processed.json with a more sophisticated tracking system
 * inspired by OpenViking's last_commit_local_index pattern.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { SessionRef } from "./types.js";

/**
 * Per-project state with incremental tracking
 */
export interface ProjectState {
  /** Project path (normalized) */
  projectPath: string;
  /** Last processed session ID */
  lastProcessedSessionId: string;
  /** Last processed timestamp (ISO string) */
  lastProcessedAt: string;
  /** Total sessions processed for this project */
  totalProcessed: number;
  /** Total experiences extracted for this project */
  totalExperiences: number;
}

/**
 * Enhanced state with incremental indexes
 */
export interface ObserverState {
  /** Global last check timestamp */
  lastCheckedAt: string;
  /** Per-project state */
  projects: Record<string, ProjectState>;
  /** Global statistics */
  stats: {
    totalProjects: number;
    totalSessionsProcessed: number;
    totalExperiencesExtracted: number;
    totalErrors: number;
  };
}

/**
 * Load state from disk
 */
export async function loadState(statePath: string): Promise<ObserverState> {
  try {
    const content = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(content);
    // Ensure projects exists
    if (!parsed.projects) {
      parsed.projects = {};
    }
    if (!parsed.stats) {
      parsed.stats = {
        totalProjects: 0,
        totalSessionsProcessed: 0,
        totalExperiencesExtracted: 0,
        totalErrors: 0,
      };
    }
    return parsed;
  } catch {
    // Return initial state
    return {
      lastCheckedAt: new Date(0).toISOString(),
      projects: {},
      stats: {
        totalProjects: 0,
        totalSessionsProcessed: 0,
        totalExperiencesExtracted: 0,
        totalErrors: 0,
      },
    };
  }
}

/**
 * Save state to disk
 */
export async function saveState(
  statePath: string,
  state: ObserverState
): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

/**
 * Normalize project path for use as key
 */
export function normalizeProjectPath(projectPath: string | undefined): string {
  if (!projectPath) return "default";
  return projectPath.replace(/\\/g, "/").toLowerCase();
}

/**
 * Get project state
 */
export function getProjectState(
  state: ObserverState,
  projectPath: string | undefined
): ProjectState | undefined {
  const key = normalizeProjectPath(projectPath);
  return state.projects[key];
}

/**
 * Get or create project state
 */
export function getOrCreateProjectState(
  state: ObserverState,
  projectPath: string | undefined
): ProjectState {
  const key = normalizeProjectPath(projectPath);
  let projectState = state.projects[key];

  if (!projectState) {
    projectState = {
      projectPath: projectPath || "default",
      lastProcessedSessionId: "",
      lastProcessedAt: new Date(0).toISOString(),
      totalProcessed: 0,
      totalExperiences: 0,
    };
    state.projects[key] = projectState;
    state.stats.totalProjects = Object.keys(state.projects).length;
  }

  return projectState;
}

/**
 * Check if a session should be processed (not yet processed)
 */
export function shouldProcessSession(
  state: ObserverState,
  session: SessionRef
): boolean {
  const projectState = getProjectState(state, session.projectPath);
  if (!projectState) return true; // No previous processing for this project
  return session.id !== projectState.lastProcessedSessionId;
}

/**
 * Get unprocessed sessions
 */
export function getUnprocessedSessions(
  state: ObserverState,
  sessions: SessionRef[]
): SessionRef[] {
  return sessions.filter((session) => shouldProcessSession(state, session));
}

/**
 * Mark session as processed
 */
export function markSessionProcessed(
  state: ObserverState,
  sessionRef: SessionRef,
  experiencesExtracted: number
): ObserverState {
  const projectState = getOrCreateProjectState(state, sessionRef.projectPath);

  // Only update if this is actually newer
  const currentLast = new Date(projectState.lastProcessedAt).getTime();
  const sessionTime = sessionRef.startedAt
    ? new Date(sessionRef.startedAt).getTime()
    : Date.now();

  if (sessionTime >= currentLast) {
    projectState.lastProcessedSessionId = sessionRef.id;
    projectState.lastProcessedAt = sessionRef.startedAt || new Date().toISOString();
    projectState.totalProcessed++;
    projectState.totalExperiences += experiencesExtracted;

    // Update global stats
    state.stats.totalSessionsProcessed++;
    state.stats.totalExperiencesExtracted += experiencesExtracted;
  }

  return state;
}

/**
 * Mark sessions processed (batch)
 */
export function markSessionsProcessed(
  state: ObserverState,
  sessions: SessionRef[],
  experiencesExtracted: number
): ObserverState {
  // Find the most recent session and use that as the marker
  const sortedSessions = [...sessions].sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bTime - aTime; // Descending
  });

  for (const session of sortedSessions) {
    state = markSessionProcessed(state, session, 0);
  }

  // Update total experiences
  state.stats.totalExperiencesExtracted += experiencesExtracted;

  return state;
}

/**
 * Record an error
 */
export function recordError(state: ObserverState): ObserverState {
  state.stats.totalErrors++;
  return state;
}

/**
 * Update last checked timestamp
 */
export function updateLastChecked(state: ObserverState): ObserverState {
  state.lastCheckedAt = new Date().toISOString();
  return state;
}
