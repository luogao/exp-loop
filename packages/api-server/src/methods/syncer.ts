import type {
  ExperienceStore,
  EpisodeStore,
  SkillRegistry,
  Experience,
} from "@exp-loop/core";
import { createClaudeMdSyncer, createSkillExporter, writeManagedSection, readManagedSection } from "@exp-loop/syncer";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { MethodHandler } from "../server.js";

export function syncerMethods(
  stores: { experienceStore: ExperienceStore; episodeStore: EpisodeStore; skillRegistry: SkillRegistry },
  dataDir: string,
): Record<string, MethodHandler> {
  const syncer = createClaudeMdSyncer({}, stores);
  const exporter = createSkillExporter({
    skillRegistry: stores.skillRegistry,
    dataDir,
  });

  return {
    "syncer.syncAll": async (params) => {
      return syncer.syncAll(params.projectRoot as string | undefined);
    },
    "syncer.sync": async (params) => {
      return syncer.sync({
        scope: params.scope as "global" | "project",
        projectRoot: params.projectRoot as string | undefined,
      });
    },
    "syncer.syncProject": async (params) => {
      const projectPath = params.projectPath as string;
      if (!projectPath) {
        return { error: "projectPath is required" };
      }

      const allExperiences = await stores.experienceStore.list({ status: "active" });
      const projectExps: Experience[] = [];

      for (const exp of allExperiences) {
        for (const epId of exp.sourceEpisodeIds) {
          const ep = await stores.episodeStore.get(epId);
          if (ep?.task?.metadata?.projectPath === projectPath) {
            projectExps.push(exp);
            break;
          }
        }
      }

      if (projectExps.length === 0) {
        return {
          target: "project",
          path: join(projectPath, "CLAUDE.md"),
          experiencesWritten: 0,
          skillSummariesWritten: 0,
          action: "unchanged",
        };
      }

      const topExps = projectExps
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 20);

      const parts: string[] = ["## Learned Experiences\n"];
      for (const exp of topExps) {
        parts.push(`### ${exp.title}`);
        parts.push(`- **When:** ${exp.applyWhen.join("; ")}`);
        parts.push(`- **Do:** ${exp.recommendation}`);
        if (exp.avoid?.length) {
          parts.push(`- **Not:** ${exp.avoid.join("; ")}`);
        }
        parts.push("");
      }
      parts.push(`_Last synced: ${new Date().toISOString()}_`);
      const managedContent = parts.join("\n");

      const targetPath = join(projectPath, "CLAUDE.md");
      let existing = "";
      try {
        existing = await readFile(targetPath, "utf-8");
      } catch { /* file doesn't exist */ }

      const existingSection = readManagedSection(existing);
      if (existingSection === managedContent.trim()) {
        return {
          target: "project",
          path: targetPath,
          experiencesWritten: topExps.length,
          skillSummariesWritten: 0,
          action: "unchanged",
        };
      }

      const newContent = writeManagedSection(existing, managedContent);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, newContent);

      return {
        target: "project",
        path: targetPath,
        experiencesWritten: topExps.length,
        skillSummariesWritten: 0,
        action: existing.trim() ? "updated" : "created",
      };
    },
    "skillExporter.export": async (params) => {
      return exporter.export({
        skillId: params.skillId as string,
        targetDir: params.targetDir as string,
        overwrite: params.overwrite as boolean | undefined,
      });
    },
    "skillExporter.listDeliveries": async () => {
      return exporter.listDeliveries();
    },
  };
}
