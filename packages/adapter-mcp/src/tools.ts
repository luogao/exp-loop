import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ExpLoopRuntime,
  EpisodeStore,
  ExperienceStore,
  PatternStore,
  SkillRegistry,
  Experience,
} from "@exp-loop/core";
import { generateId } from "@exp-loop/core";

interface Stores {
  episodeStore: EpisodeStore;
  experienceStore: ExperienceStore;
  patternStore: PatternStore;
  skillRegistry: SkillRegistry;
}

export function registerTools(
  server: McpServer,
  runtime: ExpLoopRuntime,
  stores: Stores,
): void {
  // ─── retrieve_experiences ──────────────────────────
  server.tool(
    "retrieve_experiences",
    "Retrieve relevant experiences and skills for a task. Call this before starting work to get helpful context from past executions.",
    {
      description: z.string().describe("The task description"),
      domain: z.string().optional().describe("Task domain (e.g. 'frontend', 'backend')"),
      taskType: z.string().optional().describe("Task type (e.g. 'bugfix', 'feature')"),
      tags: z.array(z.string()).optional().describe("Task tags for matching"),
    },
    async (params) => {
      const task = {
        id: generateId("task"),
        description: params.description,
        domain: params.domain,
        taskType: params.taskType,
        tags: params.tags,
      };
      const result = await runtime.beforeRun({ task });
      return {
        content: [
          {
            type: "text" as const,
            text:
              result.promptBlock ||
              "No relevant experiences or skills found.",
          },
        ],
      };
    },
  );

  // ─── record_episode ────────────────────────────────
  server.tool(
    "record_episode",
    "Record a completed task episode for experience extraction and pattern mining. Call this after finishing a task to feed the learning loop.",
    {
      description: z.string().describe("What the task was about"),
      domain: z.string().optional().describe("Task domain"),
      taskType: z.string().optional().describe("Task type"),
      status: z.enum(["success", "failure", "partial"]).describe("Task outcome"),
      steps: z
        .array(
          z.object({
            action: z.string().describe("What was done"),
            error: z.string().optional().describe("Error message if any"),
          }),
        )
        .optional()
        .describe("Execution steps taken"),
      result: z.string().optional().describe("Final result or output"),
    },
    async (params) => {
      const now = new Date().toISOString();
      const result = await runtime.afterRun({
        task: {
          id: generateId("task"),
          description: params.description,
          domain: params.domain,
          taskType: params.taskType,
        },
        status: params.status,
        trace: {
          steps: (params.steps || []).map((s, i) => ({
            index: i,
            action: s.action,
            error: s.error,
          })),
        },
        result: params.result,
        startedAt: now,
        endedAt: now,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Episode recorded: ${result.episodeId}`,
              `New experiences: ${result.newExperiences.length}`,
              `Rejected candidates: ${result.rejectedCandidates.length}`,
              `Patterns updated: ${result.updatedPatterns.length}`,
              `Skill proposals: ${result.skillProposals.length}`,
              ...result.newExperiences.map(
                (e) => `  - [${e.confidence.toFixed(2)}] ${e.title}`,
              ),
              ...result.rejectedCandidates.map(
                (r) => `  - Rejected: ${r.reason}`,
              ),
            ].join("\n"),
          },
        ],
      };
    },
  );

  // ─── list_skills ───────────────────────────────────
  server.tool(
    "list_skills",
    "List available skill summaries. Skills are distilled workflows extracted from repeated successful patterns.",
    {
      domain: z.string().optional(),
      taskType: z.string().optional(),
    },
    async (params) => {
      const summaries = await stores.skillRegistry.listSummaries(params);
      return {
        content: [
          {
            type: "text" as const,
            text: summaries.length
              ? summaries
                  .map((s) => `- **${s.name}** (${s.id}): ${s.description}`)
                  .join("\n")
              : "No skills available yet. Skills are created after enough episodes with recurring patterns.",
          },
        ],
      };
    },
  );

  // ─── load_skill ────────────────────────────────────
  server.tool(
    "load_skill",
    "Load the full content of a skill by its ID. Returns the complete skill document with workflow steps.",
    {
      id: z.string().describe("Skill ID from list_skills"),
    },
    async (params) => {
      const skill = await stores.skillRegistry.load(params.id);
      return {
        content: [
          {
            type: "text" as const,
            text: skill
              ? skill.content
              : `Skill '${params.id}' not found.`,
          },
        ],
      };
    },
  );

  // ─── search_experiences ────────────────────────────
  server.tool(
    "search_experiences",
    "Search experiences by keywords. Returns matching experiences with their recommendations.",
    {
      query: z.string().describe("Search keywords"),
      domain: z.string().optional(),
      taskType: z.string().optional(),
    },
    async (params) => {
      const experiences = await stores.experienceStore.list({
        domain: params.domain,
        taskType: params.taskType,
        status: "active",
      });

      const keywords = params.query.toLowerCase().split(/\s+/);
      const matches = experiences.filter((exp) => {
        const text = [
          exp.title,
          exp.problem,
          exp.recommendation,
          ...exp.triggers,
          ...(exp.avoid || []),
        ]
          .join(" ")
          .toLowerCase();
        return keywords.some((kw) => text.includes(kw));
      });

      return {
        content: [
          {
            type: "text" as const,
            text: matches.length
              ? matches
                  .map(
                    (e) =>
                      `## ${e.title} (${e.confidence.toFixed(2)})\n${e.recommendation}\nApply when: ${e.applyWhen.join(", ")}`,
                  )
                  .join("\n\n")
              : `No experiences matching '${params.query}'.`,
          },
        ],
      };
    },
  );

  // ─── propose_experience ────────────────────────────
  server.tool(
    "propose_experience",
    "Manually propose an experience candidate. Useful when you want to curate experiences directly without LLM extraction.",
    {
      title: z.string(),
      domain: z.string().optional(),
      taskType: z.string().optional(),
      triggers: z.array(z.string()),
      problem: z.string().describe("What problem was encountered"),
      recommendation: z
        .string()
        .describe("Positive, actionable recommendation (what TO do)"),
      avoid: z.array(z.string()).optional(),
      applyWhen: z
        .array(z.string())
        .describe("When to apply this recommendation"),
      evidence: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(1).default(0.7),
      episodeId: z.string().optional(),
    },
    async (params) => {
      const now = new Date().toISOString();
      const exp: Experience = {
        id: generateId("exp"),
        title: params.title,
        domain: params.domain,
        taskType: params.taskType,
        scope: "project",
        triggers: params.triggers,
        problem: params.problem,
        recommendation: params.recommendation,
        avoid: params.avoid,
        applyWhen: params.applyWhen,
        evidence: params.evidence,
        sourceEpisodeIds: params.episodeId ? [params.episodeId] : [],
        confidence: params.confidence,
        version: 1,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };

      await stores.experienceStore.save(exp);
      return {
        content: [
          {
            type: "text" as const,
            text: `Experience saved: ${exp.id} — ${exp.title}`,
          },
        ],
      };
    },
  );

  // ─── get_stats ─────────────────────────────────────
  server.tool("get_stats", "Get statistics about stored experiences, episodes, patterns, and skills.", {}, async () => {
    const [episodes, experiences, patterns] = await Promise.all([
      stores.episodeStore.list(),
      stores.experienceStore.list(),
      stores.patternStore.list(),
    ]);
    const skills = await stores.skillRegistry.listSummaries();

    const expByStatus = experiences.reduce(
      (acc, e) => {
        acc[e.status] = (acc[e.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const episodesByStatus = episodes.reduce(
      (acc, e) => {
        acc[e.status] = (acc[e.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "## exp-loop Statistics",
            "",
            `**Episodes**: ${episodes.length} (${Object.entries(episodesByStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "none"})`,
            `**Experiences**: ${experiences.length} (${Object.entries(expByStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "none"})`,
            `**Patterns**: ${patterns.length}`,
            `**Skills**: ${skills.length}`,
          ].join("\n"),
        },
      ],
    };
  });
}
