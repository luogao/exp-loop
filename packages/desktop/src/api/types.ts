export type EpisodeStatus = "success" | "failure" | "partial";
export type Scope = "global" | "domain" | "project";
export type ExperienceStatus = "active" | "draft" | "deprecated";
export type SkillStatus = "draft" | "active" | "deprecated";

export interface Task {
  id: string;
  description: string;
  domain?: string;
  taskType?: string;
}

export interface TraceStep {
  index: number;
  action: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface Episode {
  id: string;
  task: Task;
  status: EpisodeStatus;
  trace: { steps: TraceStep[] };
  result?: unknown;
  startedAt: string;
  endedAt: string;
}

export interface Experience {
  id: string;
  title: string;
  domain?: string;
  taskType?: string;
  scope: Scope;
  triggers: string[];
  problem: string;
  recommendation: string;
  avoid?: string[];
  applyWhen: string[];
  evidence?: string[];
  sourceEpisodeIds: string[];
  confidence: number;
  version: number;
  status: ExperienceStatus;
  projectPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Pattern {
  id: string;
  domain?: string;
  taskType?: string;
  signature: string;
  matchedEpisodeIds: string[];
  commonSteps: string[];
  successRate: number;
  support: number;
  confidence: number;
  promotion: "none" | "candidate_skill" | "existing_skill_patch";
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  domain?: string;
  taskType?: string;
  triggers: string[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  domain?: string;
  taskType?: string;
  scope: Scope;
  triggers: string[];
  version: string;
  status: SkillStatus;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface StatsResult {
  episodes: { total: number; success: number; partial: number; failure: number };
  experiences: { total: number; active: number; draft: number; deprecated: number };
  patterns: { total: number; candidateSkill: number };
  skills: { total: number };
}

export interface ProjectStats {
  projectPath: string;
  projectName: string;
  episodes: number;
  successCount: number;
  experiences: number;
  activeExperiences: number;
  lastSessionAt?: string;
}

export interface ObserveResult {
  sessionsProcessed: number;
  episodesCreated: number;
  experiencesExtracted: number;
  errors: { sessionId: string; error: string }[];
}

export interface SyncResult {
  target: "global" | "project";
  path: string;
  experiencesWritten: number;
  skillSummariesWritten: number;
  action: "created" | "updated" | "unchanged";
}

export interface SkillDelivery {
  id: string;
  skillId: string;
  skillName: string;
  deliveredTo: string;
  deliveredAt: string;
  scope: Scope;
  version: string;
}

export interface SkillExportResult {
  delivery: SkillDelivery;
  path: string;
}

export type LlmKeySource = "manual" | "codex" | "hermes" | "env";

export interface AppConfig {
  dataDir: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel: string;
  llmKeySource: LlmKeySource;
  claudeProjectsDir?: string;
  enabledSources: string[];
  selectedProjects: string[];
}

export interface DetectedSource {
  id: string;
  name: string;
  dataDir: string;
  available: boolean;
}

export interface DetectedCredential {
  source: LlmKeySource;
  label: string;
  available: boolean;
  keyPreview?: string;
}

export interface DetectedProject {
  path: string;
  name: string;
  sessionCount: number;
}

export interface SessionRef {
  id: string;
  path: string;
  projectPath?: string;
  title?: string;
}

export interface SchedulerStatus {
  running: boolean;
  selectedProjects: string[];
  state?: {
    lastCheckedAt: string;
    lastProcessedAt: string;
    lastProcessedSessionIds: Record<string, string>;
    stats: {
      totalSessionsProcessed: number;
      totalExperiencesExtracted: number;
      totalChecksPerformed: number;
      totalErrors: number;
    };
  };
}
