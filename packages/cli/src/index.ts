import { config as loadEnv } from "dotenv";
import { Command } from "commander";
import { resolve } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { createFileSystemStores } from "@exp-loop/store-fs";
import { ClaudeCodeIngestSource, createObserver } from "@exp-loop/observer";
import { createClaudeMdSyncer, createSkillExporter } from "@exp-loop/syncer";
import {
  experienceSimilarity,
  SIMILARITY_THRESHOLD,
  type Experience,
} from "@exp-loop/core";

// Load .env from cwd, then from home dir as fallback.
// override: true — a project-local .env should win over ambient env vars exported
// in the shell (e.g. an unrelated ANTHROPIC_AUTH_TOKEN), so config is explicit.
// quiet: true — dotenv v17 prints a banner to stdout by default, which pollutes
// CLI output (e.g. `--version`, machine-readable commands).
loadEnv({ quiet: true, override: true });
loadEnv({ path: resolve(homedir(), ".env"), quiet: true });

const program = new Command();

program
  .name("exp-loop")
  .description("Experience and skill loop for self-improving AI agents")
  .version("0.1.0");

function resolveDataDir(project?: string): string {
  const root = project ? resolve(project) : process.cwd();
  return resolve(root, ".exp-loop");
}

// ─── Logging helpers ─────────────────────────────────
function log(msg: string): void {
  const time = new Date().toLocaleTimeString();
  console.log(`${chalk.gray(`[${time}]`)} ${msg}`);
}

function logError(msg: string): void {
  const time = new Date().toLocaleTimeString();
  console.error(`${chalk.gray(`[${time}]`)} ${chalk.red("✗")} ${chalk.red(msg)}`);
}

async function createLlm(): Promise<(prompt: string) => Promise<string>> {
  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.CLAUDE_API_KEY ||
    "";
  if (!apiKey) {
    console.error(
      "Warning: No API key found (checked ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDE_API_KEY). Experience extraction will be skipped.",
    );
    return async () => "[]";
  }
  console.error(chalk.gray(`Using API key: ${apiKey.slice(0, 8)}...`));

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as any;
    const opts: Record<string, string> = { apiKey };
    if (process.env.ANTHROPIC_BASE_URL) opts.baseURL = process.env.ANTHROPIC_BASE_URL;
    const client = new Anthropic(opts);
    const model = process.env.EXP_LOOP_LLM_MODEL || "claude-sonnet-4-20250514";
    console.error(chalk.gray(`LLM endpoint: ${opts.baseURL ?? "default"} | model: ${model}`));

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
        console.error(`LLM call failed: ${e?.message ?? e}`);
        return "[]";
      }
    };
  } catch (initErr: any) {
    console.error(`LLM init failed: ${initErr?.message ?? initErr}`);

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
  .option("--scope <scope>", "Sync scope: global, project, or all", "project")
  .option("--project <path>", "Project root for project-scope sync (default: cwd)")
  .option("--data-dir <path>", "Data directory (default: ~/.exp-loop — where watch stores experiences)")
  .action(async (opts) => {
    // Read from ~/.exp-loop by default — that's where `watch` writes experiences.
    // (resolveDataDir points at <project>/.exp-loop, which is a different, legacy location.)
    const dataDir = opts.dataDir || resolve(homedir(), ".exp-loop");
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

// ─── exp (browse experiences) ───────────────────────
const exp = program.command("exp").description("Browse collected experiences");

exp
  .command("list")
  .description("List experiences (active by default)")
  .option("--data-dir <path>", "Data directory (default: ~/.exp-loop)")
  .option("--scope <scope>", "Filter: global, domain, project")
  .option("--all", "Include deprecated experiences")
  .action(async (opts) => {
    const dataDir = opts.dataDir || resolve(homedir(), ".exp-loop");
    const stores = createFileSystemStores(dataDir);
    const query: any = {};
    if (opts.scope) query.scope = opts.scope;
    if (!opts.all) query.status = "active";
    const exps = await stores.experienceStore.list(query);

    if (exps.length === 0) {
      console.log(opts.all ? "No experiences found." : 'No active experiences. Use --all to include deprecated.');
      return;
    }

    // Group by scope for readability.
    const byScope = new Map<string, typeof exps>();
    for (const e of exps) {
      const k = e.scope;
      if (!byScope.has(k)) byScope.set(k, []);
      byScope.get(k)!.push(e);
    }
    for (const [scope, group] of byScope) {
      console.log(chalk.bold.cyan(`\n[${scope}] (${group.length})`));
      group
        .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
        .forEach((e, i) => {
          const triggers = e.triggers.length
            ? chalk.gray(`  [${e.triggers.slice(0, 4).join(", ")}]`)
            : "";
          const flag = e.status === "deprecated" ? chalk.red(" (deprecated)") : "";
          console.log(`  ${chalk.gray(`${i + 1}.`)} ${e.title}${flag}${triggers}`);
          console.log(chalk.gray(`     ${e.id}`));
        });
    }
    console.log(chalk.gray(`\n${exps.length} experience(s). Use 'exp show <id>' for details, 'exp search <kw>' to filter.`));
  });

exp
  .command("search <keyword>")
  .description("Search experiences by keyword (title/triggers/recommendation)")
  .option("--data-dir <path>", "Data directory (default: ~/.exp-loop)")
  .option("--scope <scope>", "Filter: global, domain, project")
  .option("--all", "Include deprecated experiences")
  .action(async (keyword, opts) => {
    const dataDir = opts.dataDir || resolve(homedir(), ".exp-loop");
    const stores = createFileSystemStores(dataDir);
    const query: any = {};
    if (opts.scope) query.scope = opts.scope;
    if (!opts.all) query.status = "active";
    const exps = await stores.experienceStore.list(query);

    const kw = keyword.toLowerCase();
    const matches = exps.filter((e) => {
      const hay = [
        e.title,
        e.problem,
        e.recommendation,
        ...(e.triggers ?? []),
        ...(e.applyWhen ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(kw);
    });

    if (matches.length === 0) {
      console.log(`No experiences match "${keyword}".`);
      return;
    }
    console.log(chalk.bold(`\n${matches.length} match(es) for "${keyword}":\n`));
    matches.forEach((e, i) => {
      const flag = e.status === "deprecated" ? chalk.red(" (deprecated)") : "";
      console.log(`  ${chalk.gray(`${i + 1}.`)} ${e.title}${flag} ${chalk.gray(`[${e.scope}]`)}`);
      console.log(chalk.gray(`     ${e.id}`));
    });
  });

exp
  .command("show <id>")
  .description("Show full details of an experience by id (or list index from 'exp list')")
  .option("--data-dir <path>", "Data directory (default: ~/.exp-loop)")
  .action(async (id, opts) => {
    const dataDir = opts.dataDir || resolve(homedir(), ".exp-loop");
    const stores = createFileSystemStores(dataDir);

    // Allow passing a 1-based index from `exp list` output.
    let targetId = id;
    if (/^\d+$/.test(id)) {
      const query: any = { status: "active" };
      const exps = await stores.experienceStore.list(query);
      exps.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
      const idx = parseInt(id, 10) - 1;
      if (idx >= 0 && idx < exps.length) targetId = exps[idx].id;
    }

    const e = await stores.experienceStore.get(targetId);
    if (!e) {
      console.error(chalk.red(`Experience not found: ${id}`));
      process.exit(1);
    }

    console.log(chalk.bold.cyan(`\n${e.title}`));
    console.log(chalk.gray(`${e.id} · ${e.scope} · v${e.version} · ${e.status} · confidence ${e.confidence}`));
    if (e.triggers.length) {
      console.log(chalk.gray(`triggers: ${e.triggers.join(", ")}`));
    }
    console.log("");
    console.log(chalk.bold("Problem"));
    console.log(e.problem);
    console.log("");
    console.log(chalk.bold("Recommendation"));
    console.log(e.recommendation);
    console.log("");
    if (e.applyWhen.length) {
      console.log(chalk.bold("Apply When"));
      for (const a of e.applyWhen) console.log(`  - ${a}`);
      console.log("");
    }
    if (e.avoid?.length) {
      console.log(chalk.bold("Avoid"));
      for (const a of e.avoid) console.log(`  - ${a}`);
      console.log("");
    }
    if (e.evidence?.length) {
      console.log(chalk.bold("Evidence"));
      for (const ev of e.evidence) console.log(`  - ${ev}`);
      console.log("");
    }
    console.log(chalk.gray(`source episodes: ${e.sourceEpisodeIds.join(", ")}`));
    console.log(chalk.gray(`updated: ${e.updatedAt}`));
  });

exp
  .command("compress")
  .description("Rewrite experiences into a compact form via LLM (fewer/shorter fields)")
  .option("--data-dir <path>", "Data directory (default: ~/.exp-loop)")
  .option("--scope <scope>", "Scope: global, project (default project)", "project")
  .option("--limit <n>", "Max experiences to compress (default 30)", parseInt)
  .option("--apply", "Actually rewrite (default: dry-run, just report size savings)")
  .action(async (opts) => {
    const dataDir = opts.dataDir || resolve(homedir(), ".exp-loop");
    const stores = createFileSystemStores(dataDir);
    const llm = await createLlm();

    const exps = (await stores.experienceStore.list({
      scope: opts.scope as any,
      status: "active",
    })) as Experience[];
    const target = exps.slice(0, opts.limit ?? 30);
    if (target.length === 0) {
      console.log("No experiences to compress.");
      return;
    }

    let beforeBytes = 0;
    let afterBytes = 0;
    let compressed = 0;

    for (const e of target) {
      const before = JSON.stringify(e).length;
      const compact = await compressExperience(e, llm);
      if (!compact) {
        console.log(chalk.gray(`  ⊘ skip (LLM returned nothing): ${e.title.slice(0, 50)}`));
        continue;
      }
      const after = JSON.stringify({ ...e, ...compact }).length;
      beforeBytes += before;
      afterBytes += after;
      compressed++;
      const saving = Math.round((1 - after / before) * 100);
      console.log(
        `  ${chalk.green("✎")} ${e.title.slice(0, 50)} ${chalk.gray(`(${before}→${after} bytes, -${saving}%)`)}`,
      );
      if (opts.apply) {
        await stores.experienceStore.update(e.id, {
          title: compact.title ?? e.title,
          problem: compact.problem ?? e.problem,
          recommendation: compact.recommendation ?? e.recommendation,
          triggers: compact.triggers ?? e.triggers,
          applyWhen: compact.applyWhen ?? e.applyWhen,
          needsReview: true,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    console.log("");
    if (compressed > 0) {
      const totalSaving = Math.round((1 - afterBytes / beforeBytes) * 100);
      console.log(
        opts.apply
          ? chalk.green(`Compressed ${compressed} experience(s): ${beforeBytes}→${afterBytes} bytes (-${totalSaving}%).`)
          : chalk.gray(`Dry run. ${compressed} experience(s) would shrink ${beforeBytes}→${afterBytes} bytes (-${totalSaving}%). Re-run with --apply.`),
      );
    }
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

// ─── dedupe ─────────────────────────────────────────
program
  .command("dedupe")
  .description("Merge duplicate experiences within a scope")
  .option("--data-dir <path>", "Data directory (default: ~/.exp-loop)")
  .option("--scope <scope>", "Scope to dedupe: global, domain, project, or all", "project")
  .option("--threshold <n>", "Lexical similarity threshold 0-1 (default 0.32, lexical mode only)", parseFloat)
  .option("--semantic", "Use LLM to group paraphrased duplicates (lexical cannot). Calls the LLM once per scope.")
  .option("--apply", "Actually merge (default: dry-run, just report)")
  .action(async (opts) => {
    const dataDir = opts.dataDir || resolve(homedir(), ".exp-loop");
    const threshold = opts.threshold ?? SIMILARITY_THRESHOLD;
    const stores = createFileSystemStores(dataDir);

    // Semantic mode needs the LLM.
    const semanticLlm = opts.semantic ? await createLlm() : null;

    const scopes =
      opts.scope === "all" ? ["global", "project"] : [opts.scope];
    let totalClusters = 0;
    let totalDeprecated = 0;

    for (const scope of scopes) {
      const exps = (await stores.experienceStore.list({
        scope: scope as any,
        status: "active",
      })) as Experience[];
      if (exps.length < 2) continue;

      // Produce clusters of duplicates. Lexical = local union-find; semantic = LLM grouping.
      let clusters: Experience[][];
      if (opts.semantic) {
        console.log(chalk.gray(`[${scope}] asking LLM to group ${exps.length} experiences...`));
        clusters = await semanticClusters(exps, semanticLlm!);
      } else {
        clusters = lexicalClusters(exps, threshold);
      }

      const multiClusters = clusters.filter((c) => c.length > 1);
      if (multiClusters.length === 0) {
        console.log(chalk.gray(`[${scope}] no duplicates found (${exps.length} experiences).`));
        continue;
      }

      console.log(chalk.bold(`\n[${scope}] ${multiClusters.length} duplicate cluster(s):`));
      for (const cluster of multiClusters) {
        totalClusters++;
        // Pick the primary: longest recommendation (most information), tie-break by confidence.
        cluster.sort(
          (a, b) =>
            b.recommendation.length - a.recommendation.length ||
            b.confidence - a.confidence,
        );
        const [primary, ...rest] = cluster;
        totalDeprecated += rest.length; // count in both dry-run and apply
        console.log(
          `\n  ${chalk.green("★ keep")} ${primary.title} ${chalk.gray(`(${primary.id})`)}`,
        );
        for (const r of rest) {
          console.log(`    ${chalk.yellow("⊘ deprecate")} ${r.title} ${chalk.gray(`(${r.id})`)}`);
        }

        if (opts.apply) {
          // Merge rest into primary: union sourceEpisodeIds, evidence, applyWhen, triggers.
          const mergedSource = [
            ...new Set([
              ...primary.sourceEpisodeIds,
              ...rest.flatMap((r) => r.sourceEpisodeIds),
            ]),
          ];
          const mergedEvidence = [
            ...new Set([
              ...(primary.evidence ?? []),
              ...rest.flatMap((r) => r.evidence ?? []),
            ]),
          ];
          const mergedApplyWhen = [
            ...new Set([
              ...primary.applyWhen,
              ...rest.flatMap((r) => r.applyWhen),
            ]),
          ];
          const mergedTriggers = [
            ...new Set([
              ...primary.triggers,
              ...rest.flatMap((r) => r.triggers),
            ]),
          ];
          await stores.experienceStore.update(primary.id, {
            sourceEpisodeIds: mergedSource,
            evidence: mergedEvidence,
            applyWhen: mergedApplyWhen,
            triggers: mergedTriggers,
            needsReview: true,
            updatedAt: new Date().toISOString(),
          });
          for (const r of rest) {
            await stores.experienceStore.update(r.id, {
              status: "deprecated",
              needsReview: true,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
    }

    console.log("");
    if (opts.apply) {
      console.log(
        chalk.green(
          `Done: merged ${totalClusters} cluster(s), deprecated ${totalDeprecated} duplicate(s).`,
        ),
      );
    } else {
      console.log(
        chalk.gray(
          `Dry run. ${totalDeprecated} duplicate(s) would be deprecated across ${totalClusters} cluster(s). Re-run with --apply to merge.`,
        ),
      );
    }
  });

// ── dedupe clustering helpers ────────────────────────────────────────

/** Lexical union-find clustering on experienceSimilarity. */
function lexicalClusters(exps: Experience[], threshold: number): Experience[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) && parent.get(cur) !== cur) cur = parent.get(cur)!;
    return cur;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const e of exps) parent.set(e.id, e.id);
  for (let i = 0; i < exps.length; i++) {
    for (let j = i + 1; j < exps.length; j++) {
      if (experienceSimilarity(exps[i], exps[j]) >= threshold) {
        union(exps[i].id, exps[j].id);
      }
    }
  }
  const groups = new Map<string, Experience[]>();
  for (const e of exps) {
    const root = find(e.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(e);
  }
  return [...groups.values()];
}

/**
 * Semantic clustering: send the title list to the LLM in CHUNKS and ask it to
 * return groups of ids that express the SAME underlying lesson (even if worded
 * differently). Chunking keeps each call focused (LLMs return empty/garbage when
 * given too many items at once). Cross-chunk duplicates are caught in a second
 * pass that re-groups any experiences the LLM flagged across chunks.
 */
async function semanticClusters(
  exps: Experience[],
  llm: (prompt: string) => Promise<string>,
): Promise<Experience[][]> {
  const byId = new Map(exps.map((e) => [e.id, e]));
  const CHUNK = 20;
  const allGroups: string[][] = [];

  for (let i = 0; i < exps.length; i += CHUNK) {
    const chunk = exps.slice(i, i + CHUNK);
    const titleList = chunk.map((e) => `${e.id}: ${e.title}`).join("\n");
    const prompt = `You are grouping reusable "experiences" (lessons) by semantic equivalence. Below is a list (id: title). Group together any that express the SAME underlying lesson or practice — even if worded completely differently, in different languages, or at different abstraction levels.

Two experiences belong in the SAME group if following either one would lead to the same action. Examples of SAME: "Use local similarity for dedup" ≈ "Pre-screen candidates with lexical similarity" ≈ "Base dedup on deterministic similarity". Examples of DIFFERENT: "Union evidence on merge" vs "Batch-deduplicate with union-find" (one is merge mechanics, one is clustering strategy).

Return a JSON array of groups. Each group is an array of the FULL ids. ONLY include groups with 2+ ids. Unique experiences must be omitted entirely. Output ONLY the JSON array — no prose, no markdown fences.

Experiences:
${titleList}`;
    const raw = await llm(prompt);
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) continue;
    try {
      const groups = JSON.parse(jsonMatch[0]);
      if (Array.isArray(groups)) {
        for (const g of groups) {
          if (Array.isArray(g)) allGroups.push(g.filter((id) => typeof id === "string"));
        }
      }
    } catch {
      // skip unparseable chunk
    }
  }

  // Union-find merge across all returned groups (a chunk's group may overlap
  // another chunk's group via a shared lesson).
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let cur = id;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    return cur;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const g of allGroups) {
    for (let i = 1; i < g.length; i++) {
      if (byId.has(g[0]) && byId.has(g[i])) union(g[0], g[i]);
    }
  }

  const clusters: Experience[][] = [];
  const grouped = new Set<string>();
  // Collect multi-member clusters first.
  const byRoot = new Map<string, string[]>();
  for (const g of allGroups) {
    for (const id of g) {
      if (byId.has(id)) byRoot.set(find(id), [...(byRoot.get(find(id)) ?? []), id]);
    }
  }
  for (const [, ids] of byRoot) {
    const uniqueIds = [...new Set(ids)].filter((id) => byId.has(id) && !grouped.has(id));
    const members = uniqueIds.map((id) => {
      grouped.add(id);
      return byId.get(id)!;
    });
    if (members.length >= 2) clusters.push(members);
  }
  // Remaining experiences are singletons.
  for (const e of exps) if (!grouped.has(e.id)) clusters.push([e]);
  return clusters;
}

/**
 * Ask the LLM to rewrite one experience into a compact canonical form:
 * short title, one-line problem, one-sentence recommendation, ≤4 triggers,
 * ≤2 short applyWhen conditions. Preserves meaning, cuts verbosity.
 * Returns the fields to overwrite, or null if the LLM produced nothing usable.
 */
async function compressExperience(
  e: Experience,
  llm: (prompt: string) => Promise<string>,
): Promise<Partial<Experience> | null> {
  const prompt = `Rewrite this experience into a COMPACT canonical form. Preserve the meaning exactly, but cut all verbosity. Keep it a POSITIVE recommendation ("Use X", "Do Y").

HARD LIMITS (do not exceed):
- title: ≤10 words
- problem: ONE sentence, ≤100 characters
- recommendation: ONE sentence, ≤140 characters — the single core action
- triggers: AT MOST 4 short keywords (1-3 words each), the most discriminative
- applyWhen: AT MOST 2 conditions, each ≤70 characters
- drop avoid/evidence entirely

Count carefully. If the original already fits, return it lightly trimmed. Return ONLY a JSON object with keys: title, problem, recommendation, triggers (array of ≤4), applyWhen (array of ≤2). No prose, no markdown fences.

Original experience:
${JSON.stringify(
  {
    title: e.title,
    problem: e.problem,
    recommendation: e.recommendation,
    triggers: e.triggers,
    applyWhen: e.applyWhen,
  },
  null,
  2,
)}`;

  // The GLM proxy sometimes returns an empty content body for longer prompts;
  // retry once, then fall back to local truncation.
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await llm(prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue; // empty/non-JSON → retry
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const out: Partial<Experience> = {};
      if (typeof obj.title === "string" && obj.title.trim()) out.title = obj.title.trim();
      if (typeof obj.problem === "string" && obj.problem.trim()) out.problem = obj.problem.trim().slice(0, 120);
      if (typeof obj.recommendation === "string" && obj.recommendation.trim())
        out.recommendation = obj.recommendation.trim().slice(0, 160);
      if (Array.isArray(obj.triggers))
        out.triggers = obj.triggers.filter((t: unknown) => typeof t === "string").slice(0, 4);
      if (Array.isArray(obj.applyWhen))
        out.applyWhen = obj.applyWhen
          .filter((t: unknown) => typeof t === "string")
          .map((t: string) => t.slice(0, 80))
          .slice(0, 2);
      // Must have at least the core fields to be useful.
      if (!out.recommendation) continue;
      return out;
    } catch {
      continue; // parse error → retry
    }
  }
  // LLM gave up — fall back to a deterministic local truncation so we still
  // shrink the experience (just less intelligently).
  return localTruncate(e);
}

/** Deterministic size reduction when the LLM is unavailable/unreliable. */
function localTruncate(e: Experience): Partial<Experience> {
  return {
    problem: e.problem.slice(0, 120),
    recommendation: e.recommendation.slice(0, 160),
    triggers: e.triggers.slice(0, 4),
    applyWhen: e.applyWhen.slice(0, 2).map((s) => s.slice(0, 80)),
  };
}

// ─── reprocess ──────────────────────────────────────
program
  .command("reprocess <sessionId>")
  .description("Re-parse and re-extract a previously processed session (resets its watermark)")
  .option("--data-dir <path>", "Data directory (default: ~/.exp-loop)")
  .option("--project <path>", "Project path the session belongs to (faster lookup)")
  .action(async (sessionId, opts) => {
    const dataDir = opts.dataDir || resolve(homedir(), ".exp-loop");

    const llm = await createLlm();
    const source = new ClaudeCodeIngestSource();
    const observer = createObserver({ source, dataDir, llm });

    const existed = await observer.resetProcessed(sessionId);
    if (existed) {
      console.log(chalk.gray(`Reset watermark for ${sessionId}.`));
    } else {
      console.log(chalk.yellow(`No prior processed record for ${sessionId} — processing fresh.`));
    }

    console.log("Re-processing...");
    const result = await observer.observe({
      ...(opts.project ? { projectPath: resolve(opts.project) } : {}),
    });

    console.log(
      `Done: ${result.sessionsProcessed} session(s) processed → ${result.experiencesExtracted} experiences extracted.`,
    );
    if (result.errors.length > 0) {
      for (const e of result.errors) {
        logError(`${e.sessionId}: ${e.error}`);
      }
      if (!result.errors.some((e) => e.sessionId === sessionId)) {
        console.log(chalk.yellow(`(session ${sessionId} was not found / not matched)`));
      }
    }
  });

// ─── watch ──────────────────────────────────────────
program
  .command("watch")
  .description("Watch for new Claude Code sessions and extract experiences in real-time")
  .option("--data-dir <path>", "Data directory (default: ~/.exp-loop)")
  .option("--project <path>", "Project path to watch (default: current directory)")
  .action(async (opts) => {
    const projectPath = resolve(opts.project || process.cwd());
    const dataDir = opts.dataDir || resolve(homedir(), ".exp-loop");

    console.log("");
    console.log(
      `${chalk.bold("exploop watch")} — watching for new sessions in ${chalk.cyan(projectPath)}`,
    );
    console.log(chalk.gray("Press Ctrl+C to stop"));
    console.log("");

    const llm = await createLlm();
    const source = new ClaudeCodeIngestSource();

    // Dual-threshold gate for incremental extraction (cost control):
    //   - idleMs: only process a delta after the file has been idle this long
    //     (so we don't extract mid-conversation)
    //   - minDeltaLines: only process once enough new content has accumulated
    // Defaults: 120s idle + 30 lines. Override via env for tuning.
    const gate = {
      idleMs: Number(process.env.EXP_LOOP_IDLE_MS ?? 120000),
      minDeltaLines: Number(process.env.EXP_LOOP_MIN_DELTA_LINES ?? 30),
    };
    log(
      chalk.gray(
        `增量门槛: 空闲 ${gate.idleMs / 1000}s + 累积 ${gate.minDeltaLines} 行`,
      ),
    );

    // Use observer directly — simpler and more reliable than the scheduler.
    // No chokidar, no async watcher lifecycle — just setInterval polling.
    const observer = createObserver({
      source,
      dataDir,
      incrementalGate: gate,
      llm: async (prompt: string) => {
        const start = Date.now();
        log(`${chalk.yellow("⚙")} 调用 LLM 提取经验...`);
        const result = await llm(prompt);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        log(`${chalk.yellow("⚙")} LLM 返回 ${result.length} 字符 (${elapsed}s)`);
        return result;
      },
      callbacks: {
        onSessionStart(ref) {
          log(`${chalk.blue("→")} 发现新会话: ${chalk.white(ref.title || ref.id)}`);
        },
        onSessionDeferred(ref, reason) {
          log(chalk.gray(`${chalk.yellow("⏳")} 暂缓处理: ${ref.id.slice(0, 8)}… (${reason})`));
        },
        onSessionComplete(ref, result) {
          const expCount = result.newExperiences.length;
          const updCount = result.updatedExperiences?.length ?? 0;
          const patCount = result.updatedPatterns.length;
          if (expCount > 0 || updCount > 0) {
            log(
              `${chalk.green("✓")} 提取 ${chalk.bold(expCount)} 条新经验, 更新 ${updCount} 条${patCount > 0 ? `, ${patCount} 个模式` : ""}`,
            );
            for (const exp of result.newExperiences) {
              console.log(
                `    ${chalk.green("•")} ${exp.title} ${chalk.gray(`(${exp.scope})`)}`,
              );
            }
            for (const exp of result.updatedExperiences ?? []) {
              console.log(
                `    ${chalk.cyan("↻")} ${exp.title} ${chalk.gray(`(v${exp.version})`)}`,
              );
            }
          } else {
            log(`${chalk.green("✓")} 会话完成 (无新经验)`);
          }
        },
        onSessionError(ref, error) {
          logError(`会话失败: ${error.message}`);
        },
      },
    });

    // Stats counters
    const stats = { sessions: 0, experiences: 0, errors: 0 };

    // Run one observe pass for the selected project
    async function runOnce(): Promise<void> {
      const result = await observer.observe({ projectPath });
      stats.sessions += result.sessionsProcessed;
      stats.experiences += result.experiencesExtracted;
      stats.errors += result.errors.length;
    }

    // Graceful shutdown
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      console.log("");
      console.log(chalk.bold("已停止。本次运行:"));
      console.log(`  处理会话: ${stats.sessions}`);
      console.log(`  提取经验: ${stats.experiences}`);
      console.log(`  错误: ${stats.errors}`);
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Initial catch-up (observer's processed.json handles dedup)
    log("检查现有未处理的会话...");
    await runOnce();

    const POLL_INTERVAL = 15000; // 15 seconds
    log(chalk.green(`✓ 开始监听 (每${POLL_INTERVAL / 1000}秒检查新会话)`));
    log(chalk.gray("  在另一个终端用 Claude Code 操作后，新会话会自动处理"));

    // Polling interval keeps the process alive
    setInterval(() => {
      runOnce().catch((e) => logError(e.message));
    }, POLL_INTERVAL);
  });

program.parse();
