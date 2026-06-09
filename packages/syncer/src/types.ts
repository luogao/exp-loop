import type { Scope } from "@exp-loop/core";

export type SyncTarget = "global" | "project";

export interface SyncerConfig {
  globalPath?: string;
  projectPath?: string;
  sectionMarker?: string;
  maxExperiences?: number;
  maxSkillSummaries?: number;
}

export interface SyncResult {
  target: SyncTarget;
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
  triggeredBy: "cli" | "api";
}

export interface SkillExportOpts {
  skillId: string;
  targetDir: string;
  overwrite?: boolean;
}

export interface SkillExportResult {
  delivery: SkillDelivery;
  path: string;
}
