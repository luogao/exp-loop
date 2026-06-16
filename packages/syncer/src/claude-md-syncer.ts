import { join } from "node:path";
import { homedir } from "node:os";
import type { ExperienceStore, SkillRegistry, Experience, SkillSummary } from "@exp-loop/core";
import type { SyncerConfig, SyncResult, SyncTarget } from "./types.js";
import {
  readFileOrEmpty,
  writeFileWithDir,
  readManagedSection,
  writeManagedSection,
} from "./section-manager.js";

export interface ClaudeMdSyncer {
  sync(opts: {
    scope: SyncTarget;
    projectRoot?: string;
  }): Promise<SyncResult>;
  syncAll(projectRoot?: string): Promise<SyncResult[]>;
}

export function createClaudeMdSyncer(
  config: SyncerConfig,
  stores: { experienceStore: ExperienceStore; skillRegistry: SkillRegistry },
): ClaudeMdSyncer {
  const globalPath =
    config.globalPath ?? join(homedir(), ".claude", "CLAUDE.md");
  const projectFileName = config.projectPath ?? "CLAUDE.md";
  const maxExperiences = config.maxExperiences ?? 20;
  const maxSkillSummaries = config.maxSkillSummaries ?? 10;

  async function sync(opts: {
    scope: SyncTarget;
    projectRoot?: string;
  }): Promise<SyncResult> {
    const targetPath =
      opts.scope === "global"
        ? globalPath
        : join(opts.projectRoot ?? process.cwd(), projectFileName);

    const scopeFilter =
      opts.scope === "global" ? "global" : "project";

    const experiences = await stores.experienceStore.list({
      status: "active",
      scope: scopeFilter,
    });

    const topExperiences = experiences
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxExperiences);

    const allSummaries = await stores.skillRegistry.listSummaries({
      status: "active",
    });
    const topSkills = allSummaries.slice(0, maxSkillSummaries);

    if (topExperiences.length === 0 && topSkills.length === 0) {
      return {
        target: opts.scope,
        path: targetPath,
        experiencesWritten: 0,
        skillSummariesWritten: 0,
        action: "unchanged",
      };
    }

    const managedContent = renderManagedContent(topExperiences, topSkills);
    const existing = await readFileOrEmpty(targetPath);
    const existingSection = readManagedSection(existing);

    if (existingSection === managedContent.trim()) {
      return {
        target: opts.scope,
        path: targetPath,
        experiencesWritten: topExperiences.length,
        skillSummariesWritten: topSkills.length,
        action: "unchanged",
      };
    }

    const newContent = writeManagedSection(existing, managedContent);
    await writeFileWithDir(targetPath, newContent);

    return {
      target: opts.scope,
      path: targetPath,
      experiencesWritten: topExperiences.length,
      skillSummariesWritten: topSkills.length,
      action: existing.trim() ? "updated" : "created",
    };
  }

  return {
    sync,
    async syncAll(projectRoot?: string): Promise<SyncResult[]> {
      const results: SyncResult[] = [];
      results.push(await sync({ scope: "global" }));
      results.push(await sync({ scope: "project", projectRoot }));
      return results;
    },
  };
}

function renderManagedContent(
  experiences: Experience[],
  skills: SkillSummary[],
): string {
  const parts: string[] = [];

  if (experiences.length > 0) {
    parts.push("## Learned Experiences\n");
    for (const exp of experiences) {
      parts.push(`### ${exp.title}`);
      parts.push(`- **When:** ${exp.applyWhen.join("; ")}`);
      parts.push(`- **Do:** ${exp.recommendation}`);
      if (exp.avoid?.length) {
        parts.push(`- **Not:** ${exp.avoid.join("; ")}`);
      }
      parts.push("");
    }
  }

  if (skills.length > 0) {
    parts.push("## Available Skills\n");
    for (const s of skills) {
      const triggers = s.triggers.length
        ? ` (triggers: ${s.triggers.join(", ")})`
        : "";
      parts.push(`- **${s.name}**: ${s.description}${triggers}`);
    }
    parts.push("");
  }

  parts.push(`_Last synced: ${new Date().toISOString()}_`);

  return parts.join("\n");
}
