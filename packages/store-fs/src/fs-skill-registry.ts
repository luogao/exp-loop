import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { appendFile } from "fs/promises";
import { join } from "path";
import type {
  Skill,
  SkillSummary,
  SkillProposal,
  SkillRegistry,
  SkillQuery,
  SkillUsage,
  Scope,
} from "@exp-loop/core";
import { generateId } from "@exp-loop/core";

export class FileSystemSkillRegistry implements SkillRegistry {
  constructor(private baseDir: string) {}

  private getSkillDir(
    scope: Scope,
    domain: string | undefined,
    name: string,
  ): string {
    const scopeDir =
      scope === "global"
        ? join(this.baseDir, "skills", "global")
        : join(this.baseDir, "skills", "domain", domain ?? "default");
    return join(scopeDir, name);
  }

  async saveDraft(proposal: SkillProposal): Promise<Skill> {
    const now = new Date().toISOString();
    const skill: Skill = {
      id: generateId("skill"),
      ...proposal.proposedSkill,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    const dir = this.getSkillDir(skill.scope, skill.domain, skill.name);
    await mkdir(dir, { recursive: true });

    await writeFile(join(dir, "SKILL.md"), renderSkillMarkdown(skill));

    const { content: _, ...meta } = skill;
    (meta as Record<string, unknown>).path = join(dir, "SKILL.md");
    await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2));

    skill.path = join(dir, "SKILL.md");
    return skill;
  }

  async load(id: string): Promise<Skill | null> {
    const meta = await this.findMetaById(id);
    if (!meta) return null;

    const dir = meta._dir;
    const content = await readFile(join(dir, "SKILL.md"), "utf-8");
    const body = content.replace(/^---[\s\S]*?---\n\n?/, "");

    const { _dir, ...skillMeta } = meta;
    return { ...skillMeta, content: body } as unknown as Skill;
  }

  async listSummaries(query?: SkillQuery): Promise<SkillSummary[]> {
    const allMeta = await this.readAllMeta();
    return allMeta
      .filter((m) => {
        if (query?.domain && m.domain !== query.domain) return false;
        if (query?.taskType && m.taskType !== query.taskType) return false;
        if (query?.status && m.status !== query.status) return false;
        return true;
      })
      .map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        domain: m.domain,
        taskType: m.taskType,
        triggers: m.triggers,
      }));
  }

  async activate(id: string): Promise<void> {
    await this.updateStatus(id, "active");
  }

  async deprecate(id: string): Promise<void> {
    await this.updateStatus(id, "deprecated");
  }

  async markUsed(usage: SkillUsage): Promise<void> {
    const usageDir = join(this.baseDir, "usage");
    await mkdir(usageDir, { recursive: true });
    const line = JSON.stringify({ ...usage, _ts: new Date().toISOString() });
    await appendFile(join(usageDir, "skill-usage.jsonl"), line + "\n");
  }

  private async updateStatus(
    id: string,
    status: Skill["status"],
  ): Promise<void> {
    const meta = await this.findMetaById(id);
    if (!meta) throw new Error(`Skill not found: ${id}`);
    meta.status = status;
    meta.updatedAt = new Date().toISOString();
    const { _dir, ...rest } = meta;
    await writeFile(join(_dir, "meta.json"), JSON.stringify(rest, null, 2));
  }

  private async findMetaById(
    id: string,
  ): Promise<(Record<string, any> & { _dir: string }) | null> {
    const allMeta = await this.readAllMeta();
    return allMeta.find((m) => m.id === id) ?? null;
  }

  private async readAllMeta(): Promise<
    (Record<string, any> & { _dir: string })[]
  > {
    const results: (Record<string, any> & { _dir: string })[] = [];
    const skillsDir = join(this.baseDir, "skills");

    const scopes = await readdir(skillsDir).catch(() => [] as string[]);
    for (const scope of scopes) {
      const scopeDir = join(skillsDir, scope);
      await this.scanForMeta(scopeDir, results);
    }
    return results;
  }

  private async scanForMeta(
    dir: string,
    results: (Record<string, any> & { _dir: string })[],
  ): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Check if this directory has a meta.json
        try {
          const data = await readFile(join(fullPath, "meta.json"), "utf-8");
          const meta = JSON.parse(data);
          results.push({ ...meta, _dir: fullPath });
        } catch {
          await this.scanForMeta(fullPath, results);
        }
      }
    }
  }
}

function renderSkillMarkdown(skill: Skill): string {
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

  return `${frontmatter}\n\n${skill.content}\n`;
}
