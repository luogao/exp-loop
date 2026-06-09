import { Command } from "commander";
import { resolve } from "node:path";
import { createFileSystemStores } from "@exp-loop/store-fs";
import { ClaudeCodeIngestSource, createObserver } from "@exp-loop/observer";
import { createClaudeMdSyncer, createSkillExporter } from "@exp-loop/syncer";

const program = new Command();

program
  .name("exp-loop")
  .description("Experience and skill loop for self-improving AI agents")
  .version("0.1.0");

function resolveDataDir(project?: string): string {
  const root = project ? resolve(project) : process.cwd();
  return resolve(root, ".exp-loop");
}

async function createLlm(): Promise<(prompt: string) => Promise<string>> {
  const apiKey =
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  if (!apiKey) {
    console.error(
      "Warning: No ANTHROPIC_API_KEY set. Experience extraction will be skipped.",
    );
    return async () => "[]";
  }

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as any;
    const opts: Record<string, string> = { apiKey };
    if (process.env.ANTHROPIC_BASE_URL) opts.baseURL = process.env.ANTHROPIC_BASE_URL;
    const client = new Anthropic(opts);
    const model = process.env.EXP_LOOP_LLM_MODEL || "claude-sonnet-4-20250514";

    return async (prompt: string): Promise<string> => {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 4096,
          messages: [{ role: "user" as const, content: prompt }],
        });
        const textBlock = response.content.find((b: any) => b.type === "text");
        return textBlock ? textBlock.text : "[]";
      } catch (e: any) {
        console.error(`LLM call failed: ${e.message}`);
        return "[]";
      }
    };
  } catch {
    return async () => "[]";
  }
}

// ─── observe ────────────────────────────────────────
program
  .command("observe")
  .description("Ingest agent sessions and extract experiences")
  .option("--source <source>", "Data source", "claude-code")
  .option("--project <path>", "Filter to a specific project path")
  .option("--after <date>", "Only process sessions after this date")
  .option("--limit <n>", "Max sessions to process", parseInt)
  .action(async (opts) => {
    const dataDir = resolveDataDir(opts.project);
    const llm = await createLlm();

    const source = new ClaudeCodeIngestSource();
    const observer = createObserver({
      source,
      dataDir,
      llm,
      callbacks: {
        onSessionStart(ref) {
          console.log(`Processing: ${ref.title || ref.id}`);
        },
        onSessionComplete(ref, result) {
          console.log(
            `  → ${result.newExperiences.length} experiences, ${result.updatedPatterns.length} patterns`,
          );
        },
        onSessionError(ref, error) {
          console.error(`  ✗ ${ref.id}: ${error.message}`);
        },
      },
    });

    const result = await observer.observe({
      projectPath: opts.project,
      after: opts.after,
      limit: opts.limit,
    });

    console.log(
      `\nDone: ${result.sessionsProcessed} sessions → ${result.episodesCreated} episodes, ${result.experiencesExtracted} experiences`,
    );
    if (result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
    }
  });

// ─── sync ───────────────────────────────────────────
program
  .command("sync")
  .description("Sync learned knowledge to CLAUDE.md")
  .option("--scope <scope>", "Sync scope: global, project, or all", "all")
  .option("--project <path>", "Project root for project-scope sync")
  .action(async (opts) => {
    const dataDir = resolveDataDir(opts.project);
    const stores = createFileSystemStores(dataDir);

    const syncer = createClaudeMdSyncer({}, stores);

    if (opts.scope === "all") {
      const results = await syncer.syncAll(opts.project);
      for (const r of results) {
        console.log(`${r.target}: ${r.action} (${r.experiencesWritten} exp, ${r.skillSummariesWritten} skills) → ${r.path}`);
      }
    } else {
      const result = await syncer.sync({
        scope: opts.scope as "global" | "project",
        projectRoot: opts.project,
      });
      console.log(`${result.target}: ${result.action} (${result.experiencesWritten} exp, ${result.skillSummariesWritten} skills) → ${result.path}`);
    }
  });

// ─── learn ──────────────────────────────────────────
program
  .command("learn")
  .description("Observe sessions + sync to CLAUDE.md (combined)")
  .option("--source <source>", "Data source", "claude-code")
  .option("--project <path>", "Project path")
  .option("--after <date>", "Only sessions after this date")
  .action(async (opts) => {
    // observe
    const dataDir = resolveDataDir(opts.project);
    const llm = await createLlm();
    const source = new ClaudeCodeIngestSource();
    const observer = createObserver({ source, dataDir, llm });

    console.log("Observing sessions...");
    const observeResult = await observer.observe({
      projectPath: opts.project,
      after: opts.after,
    });
    console.log(
      `  ${observeResult.sessionsProcessed} sessions → ${observeResult.experiencesExtracted} experiences`,
    );

    // sync
    const stores = createFileSystemStores(dataDir);
    const syncer = createClaudeMdSyncer({}, stores);
    console.log("Syncing to CLAUDE.md...");
    const syncResults = await syncer.syncAll(opts.project);
    for (const r of syncResults) {
      if (r.action !== "unchanged") {
        console.log(`  ${r.target}: ${r.action} → ${r.path}`);
      }
    }
    console.log("Done.");
  });

// ─── skills ─────────────────────────────────────────
const skills = program.command("skills").description("Manage skills");

skills
  .command("list")
  .description("List available skills")
  .option("--domain <domain>", "Filter by domain")
  .action(async (opts) => {
    const dataDir = resolveDataDir();
    const stores = createFileSystemStores(dataDir);
    const summaries = await stores.skillRegistry.listSummaries({
      domain: opts.domain,
      status: "active",
    });

    if (summaries.length === 0) {
      console.log("No skills available yet.");
      return;
    }

    for (const s of summaries) {
      const triggers = s.triggers.length ? ` [${s.triggers.join(", ")}]` : "";
      console.log(`  ${s.id}  ${s.name}${triggers}`);
      console.log(`    ${s.description}`);
    }
    console.log(`\n${summaries.length} skill(s)`);
  });

skills
  .command("export <skillId>")
  .description("Export a skill to a directory")
  .option("--to <dir>", "Target directory", ".")
  .option("--overwrite", "Overwrite if exists")
  .action(async (skillId, opts) => {
    const dataDir = resolveDataDir();
    const stores = createFileSystemStores(dataDir);
    const exporter = createSkillExporter({
      skillRegistry: stores.skillRegistry,
      dataDir,
    });

    try {
      const result = await exporter.export({
        skillId,
        targetDir: resolve(opts.to),
        overwrite: opts.overwrite,
      });
      console.log(`Exported: ${result.path}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── stats ──────────────────────────────────────────
program
  .command("stats")
  .description("Show statistics")
  .option("--project <path>", "Project root")
  .action(async (opts) => {
    const dataDir = resolveDataDir(opts.project);
    const stores = createFileSystemStores(dataDir);

    const [episodes, experiences, patterns] = await Promise.all([
      stores.episodeStore.list(),
      stores.experienceStore.list(),
      stores.patternStore.list(),
    ]);
    const skills = await stores.skillRegistry.listSummaries();

    console.log("=== exp-loop stats ===");
    console.log(`Episodes:    ${episodes.length}`);
    console.log(`  success:   ${episodes.filter((e) => e.status === "success").length}`);
    console.log(`  partial:   ${episodes.filter((e) => e.status === "partial").length}`);
    console.log(`  failure:   ${episodes.filter((e) => e.status === "failure").length}`);
    console.log(`Experiences: ${experiences.length}`);
    console.log(`  active:    ${experiences.filter((e) => e.status === "active").length}`);
    console.log(`Patterns:    ${patterns.length}`);
    console.log(`  candidate: ${patterns.filter((p) => p.promotion === "candidate_skill").length}`);
    console.log(`Skills:      ${skills.length}`);
  });

program.parse();
