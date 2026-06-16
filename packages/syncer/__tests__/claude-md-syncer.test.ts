import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClaudeMdSyncer } from "../src/claude-md-syncer.js";
import type { Experience, ExperienceStore, SkillRegistry, SkillSummary, ExperienceUsage, ExpListQuery, Skill, SkillProposal, SkillUsage, SkillQuery } from "@exp-loop/core";

function makeExperience(overrides: Partial<Experience> = {}): Experience {
  return {
    id: "exp_test_1",
    title: "Use overflow-hidden for containers",
    domain: "frontend",
    taskType: "bugfix",
    scope: "global",
    triggers: ["css", "overflow"],
    problem: "Content overflows container",
    recommendation: "Apply overflow: hidden to fixed-height containers",
    avoid: ["overflow: visible on fixed-height elements"],
    applyWhen: ["Working with fixed-height containers"],
    sourceEpisodeIds: ["ep_1"],
    confidence: 0.85,
    version: 1,
    status: "active",
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    ...overrides,
  };
}

function makeStores(experiences: Experience[], skills: SkillSummary[]): {
  experienceStore: ExperienceStore;
  skillRegistry: SkillRegistry;
} {
  return {
    experienceStore: {
      async save() {},
      async get() { return null; },
      async list(query?: ExpListQuery) {
        return experiences.filter((e) => {
          if (query?.status && e.status !== query.status) return false;
          if (query?.scope && e.scope !== query.scope) return false;
          return true;
        });
      },
      async update() {},
      async recordUsage() {},
    },
    skillRegistry: {
      async listSummaries() { return skills; },
      async load() { return null; },
      async saveDraft(p: SkillProposal) { return {} as Skill; },
      async activate() {},
      async deprecate() {},
      async markUsed() {},
    },
  };
}

describe("createClaudeMdSyncer", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "syncer-test-"));
  });

  it("creates a new CLAUDE.md with experiences and skills", async () => {
    const targetPath = join(tmpDir, "CLAUDE.md");
    const stores = makeStores(
      [makeExperience()],
      [{ id: "s1", name: "frontend-bugfix", description: "Fix frontend bugs", triggers: ["css"] }],
    );

    const syncer = createClaudeMdSyncer(
      { globalPath: targetPath },
      stores,
    );

    const result = await syncer.sync({ scope: "global" });
    expect(result.action).toBe("created");
    expect(result.experiencesWritten).toBe(1);
    expect(result.skillSummariesWritten).toBe(1);

    const content = await readFile(targetPath, "utf-8");
    expect(content).toContain("<!-- exp-loop:managed:start -->");
    expect(content).toContain("Use overflow-hidden for containers");
    expect(content).toContain("**When:**");
    expect(content).toContain("**Do:**");
    expect(content).toContain("**Not:**");
    expect(content).toContain("frontend-bugfix");
    expect(content).toContain("<!-- exp-loop:managed:end -->");
  });

  it("preserves existing user content", async () => {
    const targetPath = join(tmpDir, "CLAUDE.md");
    await writeFile(targetPath, "# My Project\n\nCustom instructions here.\n");

    const stores = makeStores([makeExperience()], []);
    const syncer = createClaudeMdSyncer({ globalPath: targetPath }, stores);
    await syncer.sync({ scope: "global" });

    const content = await readFile(targetPath, "utf-8");
    expect(content).toContain("# My Project");
    expect(content).toContain("Custom instructions here.");
    expect(content).toContain("<!-- exp-loop:managed:start -->");
  });

  it("returns unchanged when no experiences or skills", async () => {
    const stores = makeStores([], []);
    const syncer = createClaudeMdSyncer({ globalPath: join(tmpDir, "CLAUDE.md") }, stores);
    const result = await syncer.sync({ scope: "global" });
    expect(result.action).toBe("unchanged");
  });

  it("filters by scope: global sync only includes global experiences", async () => {
    const stores = makeStores(
      [
        makeExperience({ id: "exp_g", scope: "global" }),
        makeExperience({ id: "exp_p", scope: "project", title: "Project specific" }),
      ],
      [],
    );

    const targetPath = join(tmpDir, "global-CLAUDE.md");
    const syncer = createClaudeMdSyncer({ globalPath: targetPath }, stores);
    const result = await syncer.sync({ scope: "global" });

    const content = await readFile(targetPath, "utf-8");
    expect(content).toContain("Use overflow-hidden");
    expect(content).not.toContain("Project specific");
    expect(result.experiencesWritten).toBe(1);
  });
});
