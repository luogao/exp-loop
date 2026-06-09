import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { SkillRegistry } from "@exp-loop/core";
import { generateId } from "@exp-loop/core";
import type { SkillDelivery, SkillExportOpts, SkillExportResult } from "./types.js";

export interface SkillExporter {
  export(opts: SkillExportOpts): Promise<SkillExportResult>;
  listDeliveries(): Promise<SkillDelivery[]>;
}

export function createSkillExporter(config: {
  skillRegistry: SkillRegistry;
  dataDir: string;
}): SkillExporter {
  const deliveriesPath = join(
    config.dataDir,
    "deliveries",
    "skill-deliveries.jsonl",
  );

  return {
    async export(opts: SkillExportOpts): Promise<SkillExportResult> {
      const skill = await config.skillRegistry.load(opts.skillId);
      if (!skill) {
        throw new Error(`Skill not found: ${opts.skillId}`);
      }

      const skillDir = join(opts.targetDir, skill.name);
      const skillPath = join(skillDir, "SKILL.md");

      if (!opts.overwrite) {
        let exists = false;
        try {
          await readFile(skillPath);
          exists = true;
        } catch {
          // file doesn't exist, proceed
        }
        if (exists) {
          throw new Error(
            `SKILL.md already exists at ${skillPath}. Use overwrite option to replace.`,
          );
        }
      }

      await mkdir(skillDir, { recursive: true });

      const frontmatter = [
        "---",
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        skill.domain ? `domain: ${skill.domain}` : null,
        skill.taskType ? `taskType: ${skill.taskType}` : null,
        `triggers: [${skill.triggers.map((t) => `"${t}"`).join(", ")}]`,
        `version: ${skill.version}`,
        `status: ${skill.status}`,
        "---",
      ]
        .filter(Boolean)
        .join("\n");

      const content = `${frontmatter}\n\n${skill.content}`;
      await writeFile(skillPath, content);

      const delivery: SkillDelivery = {
        id: generateId("del"),
        skillId: skill.id,
        skillName: skill.name,
        deliveredTo: skillPath,
        deliveredAt: new Date().toISOString(),
        scope: skill.scope,
        version: skill.version,
        triggeredBy: "api",
      };

      await mkdir(dirname(deliveriesPath), { recursive: true });
      const line = JSON.stringify(delivery) + "\n";
      try {
        const existing = await readFile(deliveriesPath, "utf-8");
        await writeFile(deliveriesPath, existing + line);
      } catch {
        await writeFile(deliveriesPath, line);
      }

      return { delivery, path: skillPath };
    },

    async listDeliveries(): Promise<SkillDelivery[]> {
      try {
        const content = await readFile(deliveriesPath, "utf-8");
        return content
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l) as SkillDelivery);
      } catch {
        return [];
      }
    },
  };
}
