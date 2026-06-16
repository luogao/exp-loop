import { invoke } from "@tauri-apps/api/core";
import type {
  Episode,
  Experience,
  Pattern,
  SkillSummary,
  Skill,
  StatsResult,
  ProjectStats,
  ObserveResult,
  SyncResult,
  SkillExportResult,
  SkillDelivery,
  AppConfig,
  DetectedSource,
  DetectedCredential,
  DetectedProject,
  SchedulerStatus,
} from "./types";

async function rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  return invoke<T>("rpc_call", { method, params: params ?? {} });
}

export const api = {
  stats: {
    get: () => rpc<StatsResult>("stats.get"),
    byProject: () => rpc<ProjectStats[]>("stats.byProject"),
  },
  episodes: {
    list: (query?: Record<string, unknown>) =>
      rpc<Episode[]>("episodes.list", { query }),
    get: (id: string) => rpc<Episode | null>("episodes.get", { id }),
  },
  experiences: {
    list: (query?: Record<string, unknown>) =>
      rpc<Experience[]>("experiences.list", { query }),
    get: (id: string) => rpc<Experience | null>("experiences.get", { id }),
  },
  patterns: {
    list: () => rpc<Pattern[]>("patterns.list"),
  },
  skills: {
    listSummaries: (query?: Record<string, unknown>) =>
      rpc<SkillSummary[]>("skills.listSummaries", { query }),
    load: (id: string) => rpc<Skill | null>("skills.load", { id }),
  },
  observer: {
    observe: (opts?: Record<string, unknown>) =>
      rpc<ObserveResult>("observer.observe", opts),
  },
  syncer: {
    syncAll: (projectRoot?: string) =>
      rpc<SyncResult[]>("syncer.syncAll", { projectRoot }),
    syncProject: (projectPath: string) =>
      rpc<SyncResult>("syncer.syncProject", { projectPath }),
  },
  skillExporter: {
    export: (opts: { skillId: string; targetDir: string; overwrite?: boolean }) =>
      rpc<SkillExportResult>("skillExporter.export", opts as unknown as Record<string, unknown>),
    listDeliveries: () => rpc<SkillDelivery[]>("skillExporter.listDeliveries"),
  },
  config: {
    get: () => rpc<AppConfig>("config.get"),
    set: (patch: Partial<AppConfig>) =>
      rpc<AppConfig>("config.set", { patch }),
    validate: (opts: { apiKey: string; baseUrl?: string; model?: string; keySource?: string }) =>
      rpc<{ valid: boolean; error?: string }>("config.validate", opts as unknown as Record<string, unknown>),
    resolveCredentials: () => rpc<DetectedCredential[]>("config.resolveCredentials"),
  },
  sources: {
    detect: () => rpc<DetectedSource[]>("sources.detect"),
    detectProjects: () => rpc<DetectedProject[]>("sources.detectProjects"),
  },
  learn: (opts?: Record<string, unknown>) =>
    rpc<{ observe: ObserveResult; sync: SyncResult[] }>("learn", opts),
  scheduler: {
    start: () => rpc<SchedulerStatus>("scheduler.start"),
    stop: () => rpc<SchedulerStatus>("scheduler.stop"),
    status: () => rpc<SchedulerStatus>("scheduler.status"),
  },
};
