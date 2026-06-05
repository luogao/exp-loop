import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import { appendFile } from "fs/promises";
import type {
  Experience,
  ExperienceStore,
  ExperienceUsage,
  ExpListQuery,
  Scope,
} from "@exp-loop/core";

export class FileSystemExperienceStore implements ExperienceStore {
  constructor(private baseDir: string) {}

  private getDir(scope: Scope, domain?: string): string {
    if (scope === "global") return join(this.baseDir, "experiences", "global");
    if (scope === "domain")
      return join(this.baseDir, "experiences", "domain", domain ?? "default");
    return join(this.baseDir, "experiences", "project");
  }

  async save(exp: Experience): Promise<void> {
    const dir = this.getDir(exp.scope, exp.domain);
    await mkdir(dir, { recursive: true });
    const content = serializeExperience(exp);
    await writeFile(join(dir, `${exp.id}.md`), content);
  }

  async get(id: string): Promise<Experience | null> {
    const expDir = join(this.baseDir, "experiences");
    return this.findById(expDir, id);
  }

  async list(query?: ExpListQuery): Promise<Experience[]> {
    const expDir = join(this.baseDir, "experiences");
    const experiences: Experience[] = [];

    const scopes = query?.scope
      ? [query.scope]
      : (["global", "domain", "project"] as Scope[]);

    for (const scope of scopes) {
      const scopeDir = join(expDir, scope);
      const entries = await this.readAllMdFiles(scopeDir);
      for (const exp of entries) {
        if (query?.domain && exp.domain !== query.domain) continue;
        if (query?.taskType && exp.taskType !== query.taskType) continue;
        if (query?.status && exp.status !== query.status) continue;
        experiences.push(exp);
      }
    }

    return experiences;
  }

  async update(id: string, patch: Partial<Experience>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Experience not found: ${id}`);
    const updated = { ...existing, ...patch };
    await this.save(updated);
  }

  async recordUsage(usage: ExperienceUsage): Promise<void> {
    const usageDir = join(this.baseDir, "usage");
    await mkdir(usageDir, { recursive: true });
    const line = JSON.stringify({ ...usage, _ts: new Date().toISOString() });
    await appendFile(join(usageDir, "experience-usage.jsonl"), line + "\n");
  }

  private async findById(
    baseDir: string,
    id: string,
  ): Promise<Experience | null> {
    const scopes: Scope[] = ["global", "domain", "project"];
    for (const scope of scopes) {
      const scopeDir = join(baseDir, scope);
      const result = await this.searchDirForId(scopeDir, id);
      if (result) return result;
    }
    return null;
  }

  private async searchDirForId(
    dir: string,
    id: string,
  ): Promise<Experience | null> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const result = await this.searchDirForId(fullPath, id);
        if (result) return result;
      } else if (entry.name === `${id}.md`) {
        const content = await readFile(fullPath, "utf-8");
        return deserializeExperience(content);
      }
    }
    return null;
  }

  private async readAllMdFiles(dir: string): Promise<Experience[]> {
    const results: Experience[] = [];
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await this.readAllMdFiles(fullPath);
        results.push(...sub);
      } else if (entry.name.endsWith(".md")) {
        try {
          const content = await readFile(fullPath, "utf-8");
          results.push(deserializeExperience(content));
        } catch {
          // skip malformed files
        }
      }
    }
    return results;
  }
}

function serializeExperience(exp: Experience): string {
  const fm: Record<string, unknown> = {
    id: exp.id,
    title: exp.title,
    domain: exp.domain,
    taskType: exp.taskType,
    scope: exp.scope,
    triggers: exp.triggers,
    confidence: exp.confidence,
    version: exp.version,
    needsReview: exp.needsReview,
    status: exp.status,
    sourceEpisodeIds: exp.sourceEpisodeIds,
    createdAt: exp.createdAt,
    updatedAt: exp.updatedAt,
  };

  if (exp.history?.length) {
    fm.history = exp.history;
  }

  const frontmatter = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");

  const sections = [`## Problem\n\n${exp.problem}`, `## Recommendation\n\n${exp.recommendation}`];

  sections.push(`## Apply When\n\n${exp.applyWhen.map((s) => `- ${s}`).join("\n")}`);

  if (exp.avoid?.length) {
    sections.push(`## Avoid\n\n${exp.avoid.map((s) => `- ${s}`).join("\n")}`);
  }

  if (exp.evidence?.length) {
    sections.push(`## Evidence\n\n${exp.evidence.map((s) => `- ${s}`).join("\n")}`);
  }

  return `---\n${frontmatter}\n---\n\n${sections.join("\n\n")}\n`;
}

function deserializeExperience(content: string): Experience {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) throw new Error("Invalid experience file: no frontmatter");

  const fm: Record<string, unknown> = {};
  for (const line of fmMatch[1].split("\n")) {
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 2);
    try {
      fm[key] = JSON.parse(value);
    } catch {
      fm[key] = value;
    }
  }

  const body = content.slice(fmMatch[0].length);

  const problem = extractSection(body, "Problem");
  const recommendation = extractSection(body, "Recommendation");
  const applyWhen = extractListSection(body, "Apply When");
  const avoid = extractListSection(body, "Avoid");
  const evidence = extractListSection(body, "Evidence");

  return {
    id: fm.id as string,
    title: fm.title as string,
    domain: fm.domain as string | undefined,
    taskType: fm.taskType as string | undefined,
    scope: fm.scope as Experience["scope"],
    triggers: fm.triggers as string[],
    problem,
    recommendation,
    applyWhen,
    avoid: avoid.length > 0 ? avoid : undefined,
    evidence: evidence.length > 0 ? evidence : undefined,
    sourceEpisodeIds: fm.sourceEpisodeIds as string[],
    confidence: fm.confidence as number,
    version: (fm.version as number) ?? 1,
    history: fm.history as Experience["history"],
    needsReview: fm.needsReview as boolean | undefined,
    status: fm.status as Experience["status"],
    createdAt: fm.createdAt as string,
    updatedAt: fm.updatedAt as string,
  };
}

function extractSection(body: string, heading: string): string {
  const regex = new RegExp(`## ${heading}\\n\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = body.match(regex);
  return match ? match[1].trim() : "";
}

function extractListSection(body: string, heading: string): string[] {
  const text = extractSection(body, heading);
  if (!text) return [];
  return text
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}
