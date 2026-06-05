# exp-loop MVP 开发指南

本文档是 `exp-loop` 的 MVP 实施规格，覆盖 v0.1 Experience Loop 和 v0.2 Skill Distillation。所有设计决策的背景参见 `EXP_LOOP_FRAMEWORK_DESIGN.md`。

---

## 目录

1. [项目初始化](#1-项目初始化)
2. [核心类型定义](#2-核心类型定义)
3. [Phase 1: Experience Loop](#3-phase-1-experience-loop)
4. [Phase 2: Skill Distillation](#4-phase-2-skill-distillation)
5. [Phase 3: CLI](#5-phase-3-cli)
6. [Phase 4: MCP Adapter](#6-phase-4-mcp-adapter)
7. [Usage Tracking 与 Merge 策略](#7-usage-tracking-与-merge-策略)
8. [存储设计](#8-存储设计)
9. [开发里程碑](#9-开发里程碑)
10. [端到端示例](#10-端到端示例)

---

## 1. 项目初始化

### 1.1 Monorepo 结构

```text
exp-loop/
  package.json              # workspace root
  pnpm-workspace.yaml
  tsconfig.base.json        # 公共 tsconfig
  vitest.workspace.ts

  packages/
    core/                   # 核心运行时
      package.json
      tsconfig.json
      tsup.config.ts
      src/
        index.ts
        types.ts
        runtime.ts
        episode-store.ts
        exp-extractor.ts
        exp-guard.ts
        experience-store.ts
        exp-retriever.ts
        context-injector.ts
        pattern-miner.ts
        skill-distiller.ts
        skill-registry.ts
      __tests__/

    store-fs/               # 文件系统存储
      package.json
      src/
        index.ts
        fs-episode-store.ts
        fs-experience-store.ts
        fs-skill-registry.ts
      __tests__/

    cli/                    # 命令行工具
      package.json
      src/
        index.ts
        commands/
      __tests__/

    adapter-mcp/            # MCP Server
      package.json
      src/
        index.ts
        tools.ts
      __tests__/

  examples/
    basic-usage/
    coding-agent/
```

### 1.2 Root package.json

```json
{
  "name": "exp-loop",
  "private": true,
  "scripts": {
    "build": "pnpm -r run build",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "eslint packages/*/src",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

### 1.3 pnpm-workspace.yaml

```yaml
packages:
  - "packages/*"
  - "examples/*"
```

### 1.4 tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

### 1.5 单包 tsup.config.ts（每个 package 复用）

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  splitting: false,
});
```

### 1.6 单包 package.json 模板（以 core 为例）

```json
{
  "name": "@exp-loop/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run"
  }
}
```

### 1.7 vitest.workspace.ts

```ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/*/vitest.config.ts"]);
```

---

## 2. 核心类型定义

> 文件：`packages/core/src/types.ts`

以下是 MVP 精简后的类型。`?` 标记的字段在 MVP 阶段为可选，但接口预留以便后续扩展。

```ts
// ─── Task ──────────────────────────────────────────

export interface Task {
  id: string;
  description: string;
  domain?: string;
  taskType?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ─── Episode ───────────────────────────────────────

export type EpisodeStatus = "success" | "failure" | "partial";

export interface TraceStep {
  index: number;
  action: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ExecutionTrace {
  steps: TraceStep[];
  toolCalls?: { name: string; args?: unknown; result?: unknown }[];
  errors?: { message: string; code?: string; step?: number }[];
  corrections?: { from: string; to: string; reason: string }[];
}

export interface Episode {
  id: string;
  task: Task;
  status: EpisodeStatus;
  trace: ExecutionTrace;
  result?: unknown;
  startedAt: string; // ISO 8601
  endedAt: string;
}

// ─── Experience ────────────────────────────────────

export type Scope = "global" | "domain" | "project";
export type ExperienceStatus = "active" | "draft" | "deprecated";

export interface Experience {
  id: string;
  title: string;
  domain?: string;
  taskType?: string;
  scope: Scope;
  triggers: string[];
  problem: string;
  recommendation: string; // 正向指导：应该怎么做
  avoid?: string[]; // 可选补充：不要怎么做
  applyWhen: string[];
  evidence?: string[];
  sourceEpisodeIds: string[];
  confidence: number; // 0-1
  version: number; // 从 1 开始，每次 merge 更新 +1
  history?: ExperienceRevision[]; // 旧版本归档
  needsReview?: boolean; // merge 后标记，等待人工确认
  status: ExperienceStatus;
  createdAt: string;
  updatedAt: string;
}

/** merge 时归档的旧版本 */
export interface ExperienceRevision {
  version: number;
  recommendation: string;
  mergedFromEpisodeId: string;
  replacedAt: string; // ISO 8601
}

export interface ExperienceCandidate {
  title: string;
  domain?: string;
  taskType?: string;
  scope?: Scope;
  triggers: string[];
  problem: string;
  recommendation: string; // 正向指导：应该怎么做
  avoid?: string[]; // 可选补充：不要怎么做
  applyWhen: string[];
  evidence?: string[];
  confidence: number;
}

// ─── Pattern ───────────────────────────────────────

export type PromotionStatus =
  | "none"
  | "candidate_skill"
  | "existing_skill_patch";

export interface Pattern {
  id: string;
  domain?: string;
  taskType?: string;
  signature: string; // 任务签名，用于聚类
  matchedEpisodeIds: string[];
  commonSteps: string[];
  commonTools?: string[];
  recurringFailures?: string[];
  successRate: number;
  support: number; // 匹配次数
  confidence: number;
  promotion: PromotionStatus;
}

// ─── Skill ─────────────────────────────────────────

export type SkillStatus = "draft" | "active" | "deprecated";

export interface Skill {
  id: string;
  name: string;
  description: string;
  domain?: string;
  taskType?: string;
  scope: Scope;
  triggers: string[];
  version: string;
  status: SkillStatus;
  sourcePatternIds: string[];
  sourceExperienceIds: string[];
  content: string; // Markdown body
  path?: string; // SKILL.md 文件路径
  createdAt: string;
  updatedAt: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  domain?: string;
  taskType?: string;
  triggers: string[];
}

export interface SkillProposal {
  id: string;
  title: string;
  reason: string;
  sourcePatternId: string;
  sourceExperienceIds: string[];
  proposedSkill: Omit<Skill, "id" | "createdAt" | "updatedAt">;
  confidence: number;
  status: "pending_review" | "auto_approved";
}

// ─── Usage Tracking ────────────────────────────────

export type UsageOutcome = "helped" | "neutral" | "harmful" | "unknown";

export interface ExperienceUsage {
  experienceId: string;
  episodeId: string;
  matchedAt: string;
  injected: boolean;
  outcome?: UsageOutcome;
}

export interface SkillUsage {
  skillId: string;
  episodeId: string;
  matchedAt: string;
  loaded: boolean;
  followed?: boolean;
  outcome?: UsageOutcome;
}

// ─── Runtime IO ────────────────────────────────────

export interface BeforeRunInput {
  task: Task;
  agent?: { name: string; version?: string };
  project?: string;
}

export interface BeforeRunResult {
  promptBlock: string;
  experiences: Experience[];
  skillSummaries: SkillSummary[];
  loadSkill: (id: string) => Promise<Skill>;
}

export interface AfterRunInput {
  task: Task;
  status: EpisodeStatus;
  trace: ExecutionTrace;
  result?: unknown;
  startedAt: string;
  endedAt: string;
}

export interface AfterRunResult {
  episodeId: string;
  newExperiences: Experience[];
  rejectedCandidates: { candidate: ExperienceCandidate; reason: string }[];
  updatedPatterns: Pattern[];
  skillProposals: SkillProposal[];
}
```

---

## 3. Phase 1: Experience Loop

### 3.1 数据流

```text
beforeRun:
  Task → ExpRetriever.retrieve() → Experience[]
       → SkillRegistry.listSummaries() → SkillSummary[]
       → ContextInjector.render() → promptBlock

afterRun:
  Task + Trace + Result → EpisodeStore.save()
                        → ExpExtractor.extract() → ExperienceCandidate[]
                        → ExpGuard.evaluate() → accepted / rejected / merged
                        → ExperienceStore.save()
```

### 3.2 模块接口与实现

#### 3.2.1 EpisodeStore

存储和查询任务执行记录。

```ts
// packages/core/src/episode-store.ts

export interface EpisodeQuery {
  domain?: string;
  taskType?: string;
  status?: EpisodeStatus;
  limit?: number;
  after?: string; // ISO date
}

export interface EpisodeStore {
  save(episode: Episode): Promise<void>;
  get(id: string): Promise<Episode | null>;
  list(query?: EpisodeQuery): Promise<Episode[]>;
}
```

**FileSystem 实现要点：**

```ts
// packages/store-fs/src/fs-episode-store.ts

import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import type { Episode, EpisodeStore, EpisodeQuery } from "@exp-loop/core";

export class FileSystemEpisodeStore implements EpisodeStore {
  constructor(private baseDir: string) {}

  async save(episode: Episode): Promise<void> {
    const year = episode.startedAt.slice(0, 4);
    const dir = join(this.baseDir, "episodes", year);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${episode.id}.json`);
    await writeFile(filePath, JSON.stringify(episode, null, 2));
  }

  async get(id: string): Promise<Episode | null> {
    // 遍历年份目录查找，或维护一个索引文件加速
    const years = await readdir(join(this.baseDir, "episodes")).catch(
      () => [] as string[]
    );
    for (const year of years) {
      const filePath = join(this.baseDir, "episodes", year, `${id}.json`);
      try {
        const data = await readFile(filePath, "utf-8");
        return JSON.parse(data) as Episode;
      } catch {
        continue;
      }
    }
    return null;
  }

  async list(query?: EpisodeQuery): Promise<Episode[]> {
    const episodes: Episode[] = [];
    const years = await readdir(join(this.baseDir, "episodes")).catch(
      () => [] as string[]
    );
    for (const year of years) {
      const dir = join(this.baseDir, "episodes", year);
      const files = await readdir(dir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const data = await readFile(join(dir, file), "utf-8");
        const ep = JSON.parse(data) as Episode;
        if (query?.domain && ep.task.domain !== query.domain) continue;
        if (query?.taskType && ep.task.taskType !== query.taskType) continue;
        if (query?.status && ep.status !== query.status) continue;
        episodes.push(ep);
      }
    }
    episodes.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    return query?.limit ? episodes.slice(0, query.limit) : episodes;
  }
}
```

#### 3.2.2 ExpExtractor

从 Episode 中提取 Experience 候选。这是 LLM 驱动的模块。

```ts
// packages/core/src/exp-extractor.ts

export interface ExtractorConfig {
  /** 调用 LLM 的函数，由使用方注入 */
  llm: (prompt: string) => Promise<string>;
  maxCandidates?: number; // 默认 3
}

export interface ExpExtractor {
  extract(episode: Episode): Promise<ExperienceCandidate[]>;
}
```

**核心实现：**

```ts
export function createExpExtractor(config: ExtractorConfig): ExpExtractor {
  return {
    async extract(episode: Episode): Promise<ExperienceCandidate[]> {
      const prompt = buildExtractionPrompt(episode);
      const raw = await config.llm(prompt);
      const candidates = parseExtractorResponse(raw);
      return candidates.slice(0, config.maxCandidates ?? 3);
    },
  };
}

function buildExtractionPrompt(episode: Episode): string {
  return `You are an experience extraction system. Analyze this task episode and extract reusable, actionable recommendations.

## Task
${JSON.stringify(episode.task, null, 2)}

## Status: ${episode.status}

## Execution Trace
${JSON.stringify(episode.trace, null, 2)}

## Result
${JSON.stringify(episode.result, null, 2)}

## Instructions
Extract 1-3 reusable experiences. Each experience MUST be framed as a **positive recommendation** — tell the agent what TO DO, not what to avoid.

Each experience must have:
- title: concise name describing the recommended practice
- problem: what situation or challenge triggers this
- recommendation: the correct approach (MUST be a positive, actionable instruction — "Use X", "Do Y", "Apply Z")
- triggers: keywords that identify when this applies
- applyWhen: specific conditions for applicability
- avoid: (optional) what NOT to do, as supplementary context only
- confidence: 0-1

### Framing rules
- The "recommendation" field is the core of the experience. It must be a direct, positive instruction.
- BAD: "Don't use get_json_object on MAP columns"
- GOOD: "Use props['key'] map-access syntax for MAP-typed columns in app_xlog tables"
- The "avoid" field is optional and supplementary. Only include it when the wrong approach is non-obvious and naming it adds clarity.

Focus on:
- Correct tool usage patterns and API idioms
- Effective workarounds for known constraints
- Corrections the agent made mid-task (extract the corrected approach, not the mistake)
- Verification steps that proved valuable

Do NOT extract:
- Temporary task state
- One-off logs or URLs
- Generic advice ("be careful", "test thoroughly")
- Purely negative lessons with no positive recommendation

Respond with a JSON array of ExperienceCandidate objects.`;
}

function parseExtractorResponse(raw: string): ExperienceCandidate[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
}
```

#### 3.2.3 ExpGuard

质量关卡：去重、校验、过滤。纯规则引擎，不需要 LLM。

```ts
// packages/core/src/exp-guard.ts

export type GuardDecision = "accept" | "reject" | "merge";

export interface GuardResult {
  decision: GuardDecision;
  reason: string;
  mergeTargetId?: string; // decision === "merge" 时指向已有 experience
}

export interface ExpGuardConfig {
  minConfidence?: number; // 默认 0.5
  minApplyWhenCount?: number; // 默认 1
  minRecommendationLength?: number; // 默认 20 chars
}

export interface ExpGuard {
  evaluate(
    candidate: ExperienceCandidate,
    existing: Experience[]
  ): Promise<GuardResult>;
}
```

**核心实现：**

```ts
export function createExpGuard(config: ExpGuardConfig = {}): ExpGuard {
  const minConfidence = config.minConfidence ?? 0.5;
  const minApplyWhen = config.minApplyWhenCount ?? 1;
  const minRecommendationLen = config.minRecommendationLength ?? 20;

  return {
    async evaluate(
      candidate: ExperienceCandidate,
      existing: Experience[]
    ): Promise<GuardResult> {
      // 规则 1: 置信度过低
      if (candidate.confidence < minConfidence) {
        return { decision: "reject", reason: `confidence ${candidate.confidence} < ${minConfidence}` };
      }

      // 规则 2: 缺少 applyWhen
      if (!candidate.applyWhen || candidate.applyWhen.length < minApplyWhen) {
        return { decision: "reject", reason: "missing or empty applyWhen" };
      }

      // 规则 3: recommendation 过短
      if (candidate.recommendation.length < minRecommendationLen) {
        return { decision: "reject", reason: `recommendation too short (${candidate.recommendation.length} < ${minRecommendationLen})` };
      }

      // 规则 4: recommendation 是纯否定句（没有正向指导）
      const rec = candidate.recommendation.toLowerCase();
      if (
        (rec.startsWith("don't") || rec.startsWith("do not") || rec.startsWith("never") || rec.startsWith("avoid")) &&
        !rec.includes("instead") && !rec.includes("use ")
      ) {
        return { decision: "reject", reason: "recommendation is purely negative — must include a positive action" };
      }

      // 规则 4: 去重 — 标题相似度检查
      const duplicate = existing.find(
        (e) =>
          e.status === "active" &&
          (e.title === candidate.title ||
            titleSimilarity(e.title, candidate.title) > 0.8)
      );
      if (duplicate) {
        return {
          decision: "merge",
          reason: `similar to existing: ${duplicate.id}`,
          mergeTargetId: duplicate.id,
        };
      }

      return { decision: "accept", reason: "passed all checks" };
    },
  };
}

function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  return (2 * intersection.length) / (wordsA.size + wordsB.size);
}
```

#### 3.2.4 ExperienceStore

Experience 的持久化和查询。

```ts
// packages/core/src/experience-store.ts

export interface ExpListQuery {
  domain?: string;
  taskType?: string;
  scope?: Scope;
  status?: ExperienceStatus;
}

export interface ExperienceStore {
  save(exp: Experience): Promise<void>;
  get(id: string): Promise<Experience | null>;
  list(query?: ExpListQuery): Promise<Experience[]>;
  update(id: string, patch: Partial<Experience>): Promise<void>;
  recordUsage(usage: ExperienceUsage): Promise<void>;
}
```

**FileSystem 实现要点：** Experience 以 Markdown + frontmatter 格式存储，按 scope 分目录。

```ts
// packages/store-fs/src/fs-experience-store.ts

import { Experience, Scope } from "@exp-loop/core";

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

  // ... get/list/update 类似
}

/** Experience → Markdown with YAML frontmatter */
function serializeExperience(exp: Experience): string {
  const frontmatter = {
    id: exp.id,
    title: exp.title,
    domain: exp.domain,
    taskType: exp.taskType,
    scope: exp.scope,
    triggers: exp.triggers,
    confidence: exp.confidence,
    status: exp.status,
    sourceEpisodeIds: exp.sourceEpisodeIds,
    createdAt: exp.createdAt,
    updatedAt: exp.updatedAt,
  };

  return `---
${Object.entries(frontmatter)
  .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  .join("\n")}
---

## Problem

${exp.problem}

## Recommendation

${exp.recommendation}

## Apply When

${exp.applyWhen.map((s) => `- ${s}`).join("\n")}

${exp.avoid?.length ? `## Avoid\n\n${exp.avoid.map((s) => `- ${s}`).join("\n")}` : ""}

${exp.evidence?.length ? `## Evidence\n\n${exp.evidence.map((s) => `- ${s}`).join("\n")}` : ""}
`;
}
```

#### 3.2.5 ExpRetriever

混合检索：关键词匹配 + 字段过滤。MVP 不依赖向量数据库。

```ts
// packages/core/src/exp-retriever.ts

export interface RetrieveInput {
  task: Task;
  topK?: number;
}

export interface ExpRetriever {
  retrieve(input: RetrieveInput): Promise<Experience[]>;
}

export interface RetrieverConfig {
  store: ExperienceStore;
  topK?: number; // 默认 5
}
```

**核心实现：** 基于 trigger/domain/taskType/tags 的加权匹配。

```ts
export function createExpRetriever(config: RetrieverConfig): ExpRetriever {
  return {
    async retrieve(input: RetrieveInput): Promise<Experience[]> {
      const topK = input.topK ?? config.topK ?? 5;
      const all = await config.store.list({ status: "active" });

      const scored = all.map((exp) => ({
        exp,
        score: computeRelevance(exp, input.task),
      }));

      scored.sort((a, b) => b.score - a.score);
      return scored
        .filter((s) => s.score > 0)
        .slice(0, topK)
        .map((s) => s.exp);
    },
  };
}

function computeRelevance(exp: Experience, task: Task): number {
  let score = 0;

  // domain 精确匹配
  if (exp.domain && exp.domain === task.domain) score += 3;

  // taskType 精确匹配
  if (exp.taskType && exp.taskType === task.taskType) score += 2;

  // trigger 关键词命中
  const taskText =
    `${task.description} ${(task.tags ?? []).join(" ")}`.toLowerCase();
  for (const trigger of exp.triggers) {
    if (taskText.includes(trigger.toLowerCase())) score += 2;
  }

  // tags 交集
  if (task.tags && exp.triggers) {
    const tagSet = new Set(task.tags.map((t) => t.toLowerCase()));
    for (const trigger of exp.triggers) {
      if (tagSet.has(trigger.toLowerCase())) score += 1;
    }
  }

  return score;
}
```

#### 3.2.6 ContextInjector

将检索到的 experiences 和 skill summaries 渲染为 prompt 文本块。

```ts
// packages/core/src/context-injector.ts

export type InjectionFormat = "markdown" | "xml" | "json";

export interface InjectorConfig {
  format?: InjectionFormat; // 默认 "markdown"
  maxExperiences?: number; // 默认 5
  maxSkillSummaries?: number; // 默认 8
}

export interface ContextInjector {
  render(experiences: Experience[], skillSummaries: SkillSummary[]): string;
}
```

**Markdown 渲染实现：**

```ts
export function createContextInjector(
  config: InjectorConfig = {}
): ContextInjector {
  const format = config.format ?? "markdown";

  return {
    render(experiences: Experience[], skillSummaries: SkillSummary[]): string {
      if (format === "markdown") {
        return renderMarkdown(experiences, skillSummaries);
      }
      if (format === "xml") {
        return renderXml(experiences, skillSummaries);
      }
      return JSON.stringify({ experiences, skillSummaries }, null, 2);
    },
  };
}

function renderMarkdown(
  experiences: Experience[],
  skillSummaries: SkillSummary[]
): string {
  const parts: string[] = [];

  if (experiences.length > 0) {
    parts.push("## Relevant Past Experiences\n");
    experiences.forEach((exp, i) => {
      parts.push(`### ${i + 1}. ${exp.title}\n`);
      parts.push(`**When:** ${exp.applyWhen.join("; ")}\n`);
      parts.push(`**Do:** ${exp.recommendation}\n`);
      if (exp.avoid?.length) {
        parts.push(`**Not:** ${exp.avoid.join("; ")}\n`);
      }
    });
  }

  if (skillSummaries.length > 0) {
    parts.push("## Available Skills\n");
    skillSummaries.forEach((s) => {
      parts.push(`- **${s.name}**: ${s.description}`);
    });
    parts.push("");
  }

  return parts.join("\n");
}

function renderXml(
  experiences: Experience[],
  skillSummaries: SkillSummary[]
): string {
  const parts: string[] = ["<exp-loop-context>"];

  if (experiences.length > 0) {
    parts.push("  <experiences>");
    experiences.forEach((exp) => {
      parts.push(`    <experience title="${exp.title}">`);
      parts.push(`      <when>${exp.applyWhen.join("; ")}</when>`);
      parts.push(`      <do>${exp.recommendation}</do>`);
      if (exp.avoid?.length) {
        parts.push(`      <not>${exp.avoid.join("; ")}</not>`);
      }
      parts.push("    </experience>");
    });
    parts.push("  </experiences>");
  }

  if (skillSummaries.length > 0) {
    parts.push("  <skills>");
    skillSummaries.forEach((s) => {
      parts.push(`    <skill name="${s.name}">${s.description}</skill>`);
    });
    parts.push("  </skills>");
  }

  parts.push("</exp-loop-context>");
  return parts.join("\n");
}
```

### 3.3 Runtime API

```ts
// packages/core/src/runtime.ts

export interface ExpLoopConfig {
  episodeStore: EpisodeStore;
  experienceStore: ExperienceStore;
  retriever: ExpRetriever;
  extractor: ExpExtractor;
  guard: ExpGuard;
  injector: ContextInjector;
  skillRegistry?: SkillRegistry; // Phase 2 加入
  patternMiner?: PatternMiner; // Phase 2 加入
  skillDistiller?: SkillDistiller; // Phase 2 加入
}

export interface ExpLoopRuntime {
  beforeRun(input: BeforeRunInput): Promise<BeforeRunResult>;
  afterRun(input: AfterRunInput): Promise<AfterRunResult>;
}

export function createExpLoop(config: ExpLoopConfig): ExpLoopRuntime {
  const {
    episodeStore,
    experienceStore,
    retriever,
    extractor,
    guard,
    injector,
    skillRegistry,
    patternMiner,
    skillDistiller,
  } = config;

  return {
    async beforeRun(input: BeforeRunInput): Promise<BeforeRunResult> {
      // 1. 检索相关 experience
      const experiences = await retriever.retrieve({
        task: input.task,
      });

      // 2. 获取 skill 摘要
      const skillSummaries = skillRegistry
        ? await skillRegistry.listSummaries({
            domain: input.task.domain,
            taskType: input.task.taskType,
          })
        : [];

      // 3. 渲染 prompt 块
      const promptBlock = injector.render(experiences, skillSummaries);

      // 4. 构造 loadSkill 函数
      const loadSkill = async (id: string): Promise<Skill> => {
        if (!skillRegistry) throw new Error("SkillRegistry not configured");
        const skill = await skillRegistry.load(id);
        if (!skill) throw new Error(`Skill not found: ${id}`);
        return skill;
      };

      return { promptBlock, experiences, skillSummaries, loadSkill };
    },

    async afterRun(input: AfterRunInput): Promise<AfterRunResult> {
      // 1. 构造并保存 episode
      const episode: Episode = {
        id: generateId("ep"),
        task: input.task,
        status: input.status,
        trace: input.trace,
        result: input.result,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      };
      await episodeStore.save(episode);

      // 2. 提取 experience 候选
      const candidates = await extractor.extract(episode);

      // 3. 对每个候选执行 guard 检查
      const existingExps = await experienceStore.list();
      const newExperiences: Experience[] = [];
      const rejectedCandidates: {
        candidate: ExperienceCandidate;
        reason: string;
      }[] = [];

      for (const candidate of candidates) {
        const guardResult = await guard.evaluate(candidate, existingExps);

        if (guardResult.decision === "accept") {
          const exp = candidateToExperience(candidate, episode.id);
          await experienceStore.save(exp);
          newExperiences.push(exp);
        } else if (guardResult.decision === "merge" && guardResult.mergeTargetId) {
          // 保守 merge：追加 episodeId 和 evidence，不自动替换 recommendation
          // 标记 needsReview，等待人工确认是否需要更新 recommendation
          const target = existingExps.find(
            (e) => e.id === guardResult.mergeTargetId
          );
          if (target) {
            await experienceStore.update(guardResult.mergeTargetId, {
              sourceEpisodeIds: [
                ...new Set([...target.sourceEpisodeIds, episode.id]),
              ],
              evidence: [
                ...new Set([
                  ...(target.evidence ?? []),
                  ...(candidate.evidence ?? []),
                ]),
              ],
              needsReview: true,
              updatedAt: new Date().toISOString(),
            });
          }
        } else {
          rejectedCandidates.push({
            candidate,
            reason: guardResult.reason,
          });
        }
      }

      // 4. Pattern mining (Phase 2)
      let updatedPatterns: Pattern[] = [];
      if (patternMiner) {
        updatedPatterns = await patternMiner.mine(episode);
      }

      // 5. Skill distillation (Phase 2)
      let skillProposals: SkillProposal[] = [];
      if (skillDistiller && updatedPatterns.length > 0) {
        for (const pattern of updatedPatterns) {
          if (pattern.promotion === "candidate_skill") {
            const proposal = await skillDistiller.distill(pattern);
            if (proposal) skillProposals.push(proposal);
          }
        }
      }

      return {
        episodeId: episode.id,
        newExperiences,
        rejectedCandidates,
        updatedPatterns,
        skillProposals,
      };
    },
  };
}

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

function candidateToExperience(
  candidate: ExperienceCandidate,
  episodeId: string
): Experience {
  const now = new Date().toISOString();
  return {
    id: generateId("exp"),
    title: candidate.title,
    domain: candidate.domain,
    taskType: candidate.taskType,
    scope: candidate.scope ?? "global",
    triggers: candidate.triggers,
    problem: candidate.problem,
    recommendation: candidate.recommendation,
    applyWhen: candidate.applyWhen,
    avoid: candidate.avoid,
    evidence: candidate.evidence,
    sourceEpisodeIds: [episodeId],
    confidence: candidate.confidence,
    version: 1,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}
```

### 3.4 Phase 1 验收标准

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | 能保存 Episode 到文件系统并读回 | 单元测试 |
| 2 | ExpExtractor 从 Episode 提取至少 1 个候选 | 集成测试（mock LLM） |
| 3 | ExpGuard 能拒绝低质量候选（缺 applyWhen、低置信度） | 单元测试 |
| 4 | ExpGuard 能检测重复并返回 merge | 单元测试 |
| 5 | ExperienceStore 能按 domain/taskType 过滤 | 单元测试 |
| 6 | Experience 以 Markdown+frontmatter 格式存储 | 文件内容断言 |
| 7 | ExpRetriever 按相关度排序，topK 有效 | 单元测试 |
| 8 | ContextInjector 产出可读 Markdown 块 | 快照测试 |
| 9 | `beforeRun` → `afterRun` 完整闭环跑通 | 集成测试 |
| 10 | Usage 记录可追加到 jsonl 文件 | 单元测试 |

---

## 4. Phase 2: Skill Distillation

### 4.1 数据流

```text
afterRun 触发:
  Episode → PatternMiner.mine()
          → 更新 Pattern（累加 matchedEpisodeIds, 重算 support/confidence）
          → 达到 promotion gate？
              是 → SkillDistiller.distill() → SkillProposal
                  → 人工/自动审批 → SkillRegistry.saveDraft()
              否 → 等待更多 episodes

beforeRun 扩展:
  → SkillRegistry.listSummaries() → SkillSummary[]（Stage 1: 仅摘要）
  → agent 选择 → loadSkill(id) → Skill（Stage 2: 完整内容）
```

### 4.2 模块接口与实现

#### 4.2.1 PatternMiner

从 episodes 中发现重复的任务结构。

```ts
// packages/core/src/pattern-miner.ts

export interface PatternMinerConfig {
  episodeStore: EpisodeStore;
  patternStore: PatternStore;
  minSupport?: number; // 默认 3
  minSuccessRate?: number; // 默认 0.6
}

export interface PatternStore {
  save(pattern: Pattern): Promise<void>;
  get(id: string): Promise<Pattern | null>;
  list(): Promise<Pattern[]>;
  update(id: string, patch: Partial<Pattern>): Promise<void>;
}

export interface PatternMiner {
  /** 接收新 episode，更新或创建 pattern，返回受影响的 patterns */
  mine(episode: Episode): Promise<Pattern[]>;
}
```

**核心实现：**

```ts
export function createPatternMiner(
  config: PatternMinerConfig
): PatternMiner {
  const minSupport = config.minSupport ?? 3;
  const minSuccessRate = config.minSuccessRate ?? 0.6;

  return {
    async mine(episode: Episode): Promise<Pattern[]> {
      const signature = computeSignature(episode);
      const existingPatterns = await config.patternStore.list();

      // 查找已有相同签名的 pattern
      const matched = existingPatterns.find(
        (p) => p.signature === signature
      );

      if (matched) {
        // 累加
        const episodeIds = [
          ...new Set([...matched.matchedEpisodeIds, episode.id]),
        ];
        const allEpisodes = await Promise.all(
          episodeIds.map((id) => config.episodeStore.get(id))
        );
        const valid = allEpisodes.filter(Boolean) as Episode[];
        const successCount = valid.filter(
          (e) => e.status === "success"
        ).length;

        const updated: Partial<Pattern> = {
          matchedEpisodeIds: episodeIds,
          support: episodeIds.length,
          successRate: successCount / episodeIds.length,
          confidence: computePatternConfidence(valid),
        };

        // 检查 promotion gate
        if (
          episodeIds.length >= minSupport &&
          updated.successRate! >= minSuccessRate &&
          matched.promotion === "none"
        ) {
          updated.promotion = "candidate_skill";
        }

        await config.patternStore.update(matched.id, updated);
        return [{ ...matched, ...updated }];
      } else {
        // 新建 pattern
        const newPattern: Pattern = {
          id: generateId("pat"),
          domain: episode.task.domain,
          taskType: episode.task.taskType,
          signature,
          matchedEpisodeIds: [episode.id],
          commonSteps: episode.trace.steps.map((s) => s.action),
          commonTools: episode.trace.toolCalls?.map((t) => t.name),
          successRate: episode.status === "success" ? 1 : 0,
          support: 1,
          confidence: 0.3,
          promotion: "none",
        };
        await config.patternStore.save(newPattern);
        return [newPattern];
      }
    },
  };
}

/**
 * 任务签名：domain + taskType 的标准化组合。
 * 用于聚类相似任务。
 */
function computeSignature(episode: Episode): string {
  const parts = [
    episode.task.domain ?? "any",
    episode.task.taskType ?? "any",
  ];
  return parts.join("::");
}

function computePatternConfidence(episodes: Episode[]): number {
  if (episodes.length === 0) return 0;
  const successRate =
    episodes.filter((e) => e.status === "success").length / episodes.length;
  const volumeFactor = Math.min(episodes.length / 5, 1);
  return successRate * 0.7 + volumeFactor * 0.3;
}
```

#### 4.2.2 SkillDistiller

将达到 promotion gate 的 Pattern 转化为 SkillProposal。LLM 驱动。

```ts
// packages/core/src/skill-distiller.ts

export interface SkillDistillerConfig {
  llm: (prompt: string) => Promise<string>;
  episodeStore: EpisodeStore;
  experienceStore: ExperienceStore;
}

export interface SkillDistiller {
  distill(pattern: Pattern): Promise<SkillProposal | null>;
}
```

**核心实现：**

```ts
export function createSkillDistiller(
  config: SkillDistillerConfig
): SkillDistiller {
  return {
    async distill(pattern: Pattern): Promise<SkillProposal | null> {
      // 1. 收集 pattern 关联的 episodes
      const episodes = (
        await Promise.all(
          pattern.matchedEpisodeIds.map((id) => config.episodeStore.get(id))
        )
      ).filter(Boolean) as Episode[];

      // 2. 收集相关 experiences
      const allExps = await config.experienceStore.list({
        domain: pattern.domain,
        taskType: pattern.taskType,
      });
      const relatedExps = allExps.filter((exp) =>
        exp.sourceEpisodeIds.some((id) =>
          pattern.matchedEpisodeIds.includes(id)
        )
      );

      // 3. LLM 生成 skill 内容
      const prompt = buildDistillPrompt(pattern, episodes, relatedExps);
      const raw = await config.llm(prompt);
      const parsed = parseSkillResponse(raw);
      if (!parsed) return null;

      const now = new Date().toISOString();
      return {
        id: generateId("sp"),
        title: parsed.name,
        reason: `Pattern ${pattern.id} reached ${pattern.support} episodes with ${(pattern.successRate * 100).toFixed(0)}% success`,
        sourcePatternId: pattern.id,
        sourceExperienceIds: relatedExps.map((e) => e.id),
        proposedSkill: {
          name: parsed.name,
          description: parsed.description,
          domain: pattern.domain,
          taskType: pattern.taskType,
          scope: pattern.domain ? "domain" : "global",
          triggers: parsed.triggers,
          version: "0.1.0",
          status: "draft",
          sourcePatternIds: [pattern.id],
          sourceExperienceIds: relatedExps.map((e) => e.id),
          content: parsed.content,
        },
        confidence: pattern.confidence,
        status: "pending_review",
      };
    },
  };
}

function buildDistillPrompt(
  pattern: Pattern,
  episodes: Episode[],
  experiences: Experience[]
): string {
  return `You are a skill distillation system. Based on repeated task patterns and accumulated experiences, generate a reusable skill document.

## Pattern
Signature: ${pattern.signature}
Episodes: ${pattern.support}
Success rate: ${(pattern.successRate * 100).toFixed(0)}%
Common steps: ${pattern.commonSteps.join(" → ")}
Common tools: ${pattern.commonTools?.join(", ") ?? "none"}
Recurring failures: ${pattern.recurringFailures?.join(", ") ?? "none"}

## Sample Episodes (${episodes.length})
${episodes
  .slice(0, 3)
  .map(
    (ep) => `- [${ep.status}] ${ep.task.description} (${ep.trace.steps.length} steps)`
  )
  .join("\n")}

## Related Experiences (${experiences.length})
${experiences.map((exp) => `- ${exp.title}: ${exp.recommendation}`).join("\n")}

## Instructions
Generate a skill with:
- name: short kebab-case name
- description: one-line description
- triggers: keywords array
- content: full Markdown body with sections:
  - When To Use
  - Workflow (numbered steps)
  - Common Pitfalls
  - Verification

Respond with JSON: { name, description, triggers, content }`;
}

function parseSkillResponse(
  raw: string
): {
  name: string;
  description: string;
  triggers: string[];
  content: string;
} | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}
```

#### 4.2.3 SkillRegistry

Skill 的注册、存储、加载。

```ts
// packages/core/src/skill-registry.ts

export interface SkillQuery {
  domain?: string;
  taskType?: string;
  status?: SkillStatus;
}

export interface SkillRegistry {
  listSummaries(query?: SkillQuery): Promise<SkillSummary[]>;
  load(id: string): Promise<Skill | null>;
  saveDraft(proposal: SkillProposal): Promise<Skill>;
  activate(id: string): Promise<void>;
  deprecate(id: string): Promise<void>;
  markUsed(usage: SkillUsage): Promise<void>;
}
```

**FileSystem 实现要点：** 每个 skill 是一个目录，包含 `SKILL.md`（Markdown 内容）+ `meta.json`（结构化元数据）。

```ts
// packages/store-fs/src/fs-skill-registry.ts

export class FileSystemSkillRegistry implements SkillRegistry {
  constructor(private baseDir: string) {}

  private getSkillDir(scope: Scope, domain: string | undefined, name: string): string {
    const scopeDir = scope === "global"
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

    const dir = this.getSkillDir(
      skill.scope,
      skill.domain,
      skill.name
    );
    await mkdir(dir, { recursive: true });

    // 写 SKILL.md
    const skillMd = renderSkillMarkdown(skill);
    await writeFile(join(dir, "SKILL.md"), skillMd);

    // 写 meta.json
    const { content, ...meta } = skill;
    await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2));

    skill.path = join(dir, "SKILL.md");
    return skill;
  }

  async load(id: string): Promise<Skill | null> {
    // 遍历 skills 目录查找 meta.json 中 id 匹配的
    // 读取 SKILL.md 作为 content
    // ...
  }

  async listSummaries(query?: SkillQuery): Promise<SkillSummary[]> {
    // 遍历所有 meta.json, 过滤后返回摘要
    // ...
  }
}

function renderSkillMarkdown(skill: Skill): string {
  const frontmatter = [
    `---`,
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `domain: ${skill.domain ?? ""}`,
    `taskType: ${skill.taskType ?? ""}`,
    `triggers: [${skill.triggers.map((t) => `"${t}"`).join(", ")}]`,
    `version: ${skill.version}`,
    `status: ${skill.status}`,
    `---`,
  ].join("\n");

  return `${frontmatter}\n\n${skill.content}`;
}
```

### 4.3 Promotion Gate 配置

```ts
export interface PromotionGateConfig {
  minSupport: number; // 默认 3
  minSuccessCount: number; // 默认 2
  minConfidence: number; // 默认 0.75
}

// 默认值
const DEFAULT_GATE: PromotionGateConfig = {
  minSupport: 3,
  minSuccessCount: 2,
  minConfidence: 0.75,
};
```

### 4.4 Phase 2 验收标准

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | 新 episode 能触发 pattern 创建/更新 | 单元测试 |
| 2 | 相同签名的 episode 累加到同一 pattern | 单元测试 |
| 3 | Pattern 达到 3 次 + 60% 成功率时 promotion 变为 candidate_skill | 单元测试 |
| 4 | SkillDistiller 能从 pattern + episodes + experiences 生成 SkillProposal | 集成测试（mock LLM） |
| 5 | SkillProposal 能保存为 SKILL.md + meta.json | 文件内容断言 |
| 6 | listSummaries 只返回摘要，不含完整 content | 单元测试 |
| 7 | loadSkill 返回完整 Skill（含 Markdown content） | 单元测试 |
| 8 | beforeRun 的 promptBlock 包含 skill summaries | 集成测试 |
| 9 | 完整闭环：3 次 afterRun 后自动产出 SkillProposal | 端到端测试 |

---

## 5. Phase 3: CLI

### 5.1 命令设计

CLI 包名：`@exp-loop/cli`，可执行文件名：`exp-loop`。依赖 `@exp-loop/core` 和 `@exp-loop/store-fs`。

```text
exp-loop init                             # 初始化 .exp-loop/ 目录和 config.json
exp-loop search <query>                   # 搜索 experiences
exp-loop episodes list [--domain] [--status]  # 列出 episodes
exp-loop experiences list [--domain] [--scope] # 列出 experiences
exp-loop experiences validate             # 检查所有 experience 的质量
exp-loop patterns list                    # 列出 patterns
exp-loop skills list                      # 列出 skills
exp-loop skills show <id>                 # 显示完整 skill 内容
exp-loop skills propose --pattern <id>    # 手动触发 skill proposal
exp-loop skills activate <id>            # 将 draft skill 激活
exp-loop stats                            # 统计概览
```

### 5.2 实现示例

使用 `commander` 作为 CLI 框架。

```ts
// packages/cli/src/index.ts

import { Command } from "commander";
import { createFileSystemStores } from "@exp-loop/store-fs";

const program = new Command();

program.name("exp-loop").description("Experience and skill loop CLI").version("0.1.0");

program
  .command("init")
  .description("Initialize .exp-loop directory")
  .action(async () => {
    const dir = join(process.cwd(), ".exp-loop");
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, "episodes"), { recursive: true });
    await mkdir(join(dir, "experiences", "global"), { recursive: true });
    await mkdir(join(dir, "patterns"), { recursive: true });
    await mkdir(join(dir, "skills", "global"), { recursive: true });
    await mkdir(join(dir, "usage"), { recursive: true });

    const defaultConfig = {
      store: { type: "filesystem", path: ".exp-loop" },
      retrieval: { topK: 5, strategy: "hybrid" },
      guard: { dedupe: true, minConfidence: 0.5 },
      patterns: { minSupport: 3, minSuccessRate: 0.6 },
      skills: { autoApprove: false, maxSkillBytes: 15360 },
      injection: { format: "markdown", maxExperiences: 5, maxSkillSummaries: 8 },
    };
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify(defaultConfig, null, 2)
    );
    console.log("Initialized .exp-loop/");
  });

program
  .command("search <query>")
  .description("Search experiences by keyword")
  .action(async (query: string) => {
    const stores = createFileSystemStores(".exp-loop");
    const exps = await stores.experienceStore.list();
    const results = exps.filter(
      (e) =>
        e.title.toLowerCase().includes(query.toLowerCase()) ||
        e.recommendation.toLowerCase().includes(query.toLowerCase()) ||
        e.triggers.some((t) => t.toLowerCase().includes(query.toLowerCase()))
    );
    results.forEach((e) => {
      console.log(`[${e.id}] ${e.title}`);
      console.log(`  ${e.recommendation.slice(0, 100)}`);
      console.log();
    });
    console.log(`Found ${results.length} experience(s)`);
  });

program
  .command("stats")
  .description("Show statistics")
  .action(async () => {
    const stores = createFileSystemStores(".exp-loop");
    const episodes = await stores.episodeStore.list();
    const exps = await stores.experienceStore.list();
    const patterns = await stores.patternStore.list();
    const skills = await stores.skillRegistry.listSummaries();

    console.log("=== exp-loop stats ===");
    console.log(`Episodes:    ${episodes.length}`);
    console.log(`  success:   ${episodes.filter((e) => e.status === "success").length}`);
    console.log(`  failure:   ${episodes.filter((e) => e.status === "failure").length}`);
    console.log(`Experiences: ${exps.length}`);
    console.log(`  active:    ${exps.filter((e) => e.status === "active").length}`);
    console.log(`  draft:     ${exps.filter((e) => e.status === "draft").length}`);
    console.log(`Patterns:    ${patterns.length}`);
    console.log(`  candidate: ${patterns.filter((p) => p.promotion === "candidate_skill").length}`);
    console.log(`Skills:      ${skills.length}`);
  });

program.parse();
```

---

## 6. Phase 4: MCP Adapter

### 6.1 Tool Schema

MCP Server 暴露以下 tools，让任何 MCP-compatible agent 都能使用 exp-loop：

| Tool | 描述 | 参数 |
|------|------|------|
| `retrieve_experiences` | 检索相关 experiences | `{ task: Task }` |
| `list_skills` | 列出可用 skill 摘要 | `{ domain?, taskType? }` |
| `load_skill` | 加载完整 skill | `{ id: string }` |
| `record_episode` | 记录一次任务执行 | `{ task, status, trace, result, startedAt, endedAt }` |
| `propose_experience` | 手动提交 experience 候选 | `{ candidate: ExperienceCandidate, episodeId }` |
| `search_experiences` | 关键词搜索 experiences | `{ query: string }` |
| `get_stats` | 获取统计概览 | `{}` |

### 6.2 实现示例

基于 `@modelcontextprotocol/sdk`：

```ts
// packages/adapter-mcp/src/tools.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ExpLoopRuntime } from "@exp-loop/core";

export function registerTools(
  server: McpServer,
  runtime: ExpLoopRuntime,
  stores: Stores
) {
  server.tool(
    "retrieve_experiences",
    "Retrieve relevant experiences for a task",
    {
      description: z.string(),
      domain: z.string().optional(),
      taskType: z.string().optional(),
      tags: z.array(z.string()).optional(),
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
            text: result.promptBlock,
          },
        ],
      };
    }
  );

  server.tool(
    "record_episode",
    "Record a completed task episode for experience extraction",
    {
      description: z.string(),
      domain: z.string().optional(),
      taskType: z.string().optional(),
      status: z.enum(["success", "failure", "partial"]),
      steps: z.array(
        z.object({
          action: z.string(),
          error: z.string().optional(),
        })
      ),
      result: z.string().optional(),
    },
    async (params) => {
      const result = await runtime.afterRun({
        task: {
          id: generateId("task"),
          description: params.description,
          domain: params.domain,
          taskType: params.taskType,
        },
        status: params.status,
        trace: {
          steps: params.steps.map((s, i) => ({
            index: i,
            action: s.action,
            error: s.error,
          })),
        },
        result: params.result,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Episode recorded: ${result.episodeId}`,
              `New experiences: ${result.newExperiences.length}`,
              `Rejected: ${result.rejectedCandidates.length}`,
              `Patterns updated: ${result.updatedPatterns.length}`,
              `Skill proposals: ${result.skillProposals.length}`,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.tool("list_skills", "List available skill summaries", {
    domain: z.string().optional(),
    taskType: z.string().optional(),
  }, async (params) => {
    const summaries = await stores.skillRegistry.listSummaries(params);
    return {
      content: [
        {
          type: "text" as const,
          text: summaries.length
            ? summaries.map((s) => `- **${s.name}**: ${s.description}`).join("\n")
            : "No skills available.",
        },
      ],
    };
  });

  server.tool("load_skill", "Load full skill content", {
    id: z.string(),
  }, async (params) => {
    const skill = await stores.skillRegistry.load(params.id);
    return {
      content: [
        {
          type: "text" as const,
          text: skill ? skill.content : `Skill ${params.id} not found.`,
        },
      ],
    };
  });
}
```

### 6.3 MCP Server 入口

```ts
// packages/adapter-mcp/src/index.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createExpLoop } from "@exp-loop/core";
import { createFileSystemStores } from "@exp-loop/store-fs";
import { registerTools } from "./tools.js";

const server = new McpServer({
  name: "exp-loop",
  version: "0.1.0",
});

const stores = createFileSystemStores(".exp-loop");
const runtime = createExpLoop({ ...stores /* + extractor, guard, etc. */ });

registerTools(server, runtime, stores);

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## 7. Usage Tracking 与 Merge 策略

### 7.1 整体设计

Usage tracking 分三个阶段逐步建设：

| 阶段 | 内容 | 时间 |
|------|------|------|
| MVP 同期 | 记录层（JSONL 写入）+ `mark_usage` CLI/MCP 接口 | v0.1-v0.2 |
| v0.3 | confidence 自动调节 + stale 检测 + deprecated 自动化 | v0.3 |
| v0.4 | error 复现检测 + 统计比较 + 数据驱动 merge 升级 | v0.4 |

核心原则：**先有数据再有策略**，不在没有 usage 数据时设计复杂自动化规则。

### 7.2 数据采集（MVP）

`beforeRun` 时记录注入了什么，`afterRun` 时或用户显式调用时回填 outcome：

```ts
// beforeRun 自动记录
const usage: ExperienceUsage = {
  experienceId: exp.id,
  episodeId: currentEpisodeId,
  matchedAt: new Date().toISOString(),
  injected: true,
  outcome: undefined, // 待回填
};

// 显式反馈（CLI 或 MCP tool）
await stores.experienceStore.recordUsage({
  experienceId: "exp_xxx",
  episodeId: "ep_xxx",
  matchedAt: "...",
  injected: true,
  outcome: "helped", // 用户/agent 主动标记
});
```

MVP 阶段的 outcome 信号源：
- **显式反馈**：用户或 agent 通过 `mark_usage` 主动标记
- **同类 error 复现检测（简化版）**：afterRun 时检查同 domain+taskType 的最近 N 个 episode 是否重复出现相同 error signature

### 7.3 保守 Merge 策略（MVP）

当 ExpGuard 判定 `merge` 时：

```text
1. 追加新 episodeId 到 sourceEpisodeIds
2. 合并新 evidence 到 evidence 列表
3. 标记 needsReview = true
4. 不修改 recommendation
```

只有满足以下条件时，才允许自动替换 recommendation（v0.3+）：

```text
该 experience 的 usage outcome 中 "helped" ≥ 3 次
且 "harmful" = 0 次
且 新候选的 confidence > 当前 confidence
```

自动替换时的版本归档：

```ts
// 将旧版本推入 history
const revision: ExperienceRevision = {
  version: existing.version,
  recommendation: existing.recommendation,
  mergedFromEpisodeId: newEpisodeId,
  replacedAt: new Date().toISOString(),
};

await experienceStore.update(existing.id, {
  recommendation: newCandidate.recommendation,
  version: existing.version + 1,
  history: [...(existing.history ?? []), revision],
  needsReview: false,
  updatedAt: new Date().toISOString(),
});
```

### 7.4 数据消费规则（v0.3+）

| outcome 分布 | 自动动作 |
|---|---|
| helped ≥ 3 次，harmful = 0 | confidence 上调至 `min(confidence + 0.1, 1.0)`；merge 时允许自动替换 recommendation |
| harmful ≥ 2 次 | confidence 下调至 `max(confidence - 0.2, 0)`；超过阈值自动 deprecated |
| 90 天未被检索命中 | 标记 stale，进入 review 队列 |
| neutral 占多数 | 不动，可能是检索精度问题而非 experience 质量问题 |

### 7.5 Skill Usage Tracking

与 Experience 类似，但多跟踪 `followed`（agent 是否按 skill 步骤执行）和 `verified`（是否执行了验证步骤）：

```ts
const skillUsage: SkillUsage = {
  skillId: "skill_xxx",
  episodeId: "ep_xxx",
  matchedAt: "...",
  loaded: true,
  followed: true,
  outcome: "helped",
};
```

Skill 的 usage 数据用于判断是否需要 patch 或 deprecate（v0.3+）。

---

## 8. 存储设计

### 7.1 目录结构

```text
.exp-loop/
  config.json                          # 全局配置

  episodes/
    2026/
      ep_xxx.json                      # Episode JSON

  experiences/
    global/
      exp_xxx.md                       # Markdown + frontmatter
    domain/
      data-analysis/
        exp_xxx.md
    project/
      exp_xxx.md

  patterns/
    pat_xxx.json                       # Pattern JSON

  skills/
    global/
      skill-name/
        SKILL.md                       # Markdown + frontmatter
        meta.json                      # 结构化元数据
    domain/
      data-analysis/
        skill-name/
          SKILL.md
          meta.json

  usage/
    experience-usage.jsonl             # 追加写入
    skill-usage.jsonl                  # 追加写入
```

### 7.2 store-fs 统一入口

```ts
// packages/store-fs/src/index.ts

export interface FileSystemStores {
  episodeStore: EpisodeStore;
  experienceStore: ExperienceStore;
  patternStore: PatternStore;
  skillRegistry: SkillRegistry;
}

export function createFileSystemStores(baseDir: string): FileSystemStores {
  const resolved = resolve(baseDir);
  return {
    episodeStore: new FileSystemEpisodeStore(resolved),
    experienceStore: new FileSystemExperienceStore(resolved),
    patternStore: new FileSystemPatternStore(resolved),
    skillRegistry: new FileSystemSkillRegistry(resolved),
  };
}
```

### 7.3 Usage 追踪

Usage 数据以 JSONL 格式追加写入，便于后续分析和 rotation：

```ts
async function appendUsage(
  baseDir: string,
  filename: string,
  record: ExperienceUsage | SkillUsage
): Promise<void> {
  const usageDir = join(baseDir, "usage");
  await mkdir(usageDir, { recursive: true });
  const line = JSON.stringify({ ...record, _ts: new Date().toISOString() });
  await appendFile(join(usageDir, filename), line + "\n");
}
```

---

## 9. 开发里程碑

### Week 1-2: 基础设施 + Experience 存储

**Deliverables:**
- monorepo 搭建完成（pnpm + tsup + vitest）
- `@exp-loop/core` 中的类型定义 (`types.ts`)，含 `ExperienceRevision`、`version`、`needsReview` 等字段
- `EpisodeStore` 接口 + FileSystem 实现
- `ExperienceStore` 接口 + FileSystem 实现（Markdown+frontmatter）
- Usage 记录层（JSONL 追加写入）
- 测试 fixtures（mock episode 数据，后续所有模块复用）
- 对应单元测试

**验证:** `pnpm test` 全绿，能读写 episode 和 experience 文件，usage JSONL 可追加

### Week 3: Experience 提取 + 质量关卡

**Deliverables:**
- `ExpExtractor`（正向推荐 prompt + response parser）
- `ExpGuard`（去重、质量检查、纯否定拒绝、保守 merge + needsReview 标记）
- 集成测试（mock LLM）

**验证:** 给定 episode → 提取候选 → guard 过滤/merge → 存储，闭环跑通

### Week 4: 检索 + 注入 + Runtime

**Deliverables:**
- `ExpRetriever`（keyword hybrid 检索）
- `ContextInjector`（Markdown / XML / JSON 渲染，When/Do/Not 格式）
- `createExpLoop` runtime（beforeRun + afterRun，含 usage 自动记录）
- 端到端集成测试

**验证:** beforeRun 返回 promptBlock 并写入 usage 记录；afterRun 产出 experiences

### Week 5: Pattern Mining + Skill Distillation

**Deliverables:**
- `PatternStore` 接口 + FileSystem 实现
- `PatternMiner`（签名聚类 + promotion gate）
- `SkillDistiller`（LLM 生成 SKILL.md）
- `SkillRegistry`（list/load/saveDraft）

**验证:** 3 次相同签名 afterRun → pattern promotion → skill proposal 产出

### Week 6: CLI + MCP + 文档

**Deliverables:**
- `@exp-loop/cli` 基本命令（init, search, stats, skills list, mark-usage）
- `@exp-loop/adapter-mcp` MCP Server（含 `mark_usage` tool）
- README 和使用文档
- examples/ 目录包含可运行示例

**验证:** CLI 可安装执行；MCP server 可在 Claude Code 中使用；`mark_usage` 可回填 outcome

---

## 10. 端到端示例

以一个 coding agent 修 bug 的场景，走完 experience → pattern → skill 完整闭环。

### 10.1 第一次任务执行

```ts
import { createExpLoop } from "@exp-loop/core";
import { createFileSystemStores } from "@exp-loop/store-fs";

// 初始化
const stores = createFileSystemStores(".exp-loop");
const loop = createExpLoop({
  ...stores,
  extractor: createExpExtractor({ llm: callLLM }),
  guard: createExpGuard(),
  retriever: createExpRetriever({ store: stores.experienceStore }),
  injector: createContextInjector(),
  patternMiner: createPatternMiner({
    episodeStore: stores.episodeStore,
    patternStore: stores.patternStore,
  }),
  skillDistiller: createSkillDistiller({
    llm: callLLM,
    episodeStore: stores.episodeStore,
    experienceStore: stores.experienceStore,
  }),
});

// ─── 第一次任务 ──────────────────────

const task1 = {
  id: "task_001",
  description: "Fix CSS overflow bug in sidebar component",
  domain: "frontend",
  taskType: "bugfix",
  tags: ["css", "layout"],
};

// 1. beforeRun — 初次没有经验
const prep1 = await loop.beforeRun({ task: task1 });
console.log(prep1.promptBlock);
// => ""（无匹配 experience 和 skill）

// 2. Agent 执行任务...（外部逻辑）

// 3. afterRun — 记录结果
const result1 = await loop.afterRun({
  task: task1,
  status: "success",
  trace: {
    steps: [
      { index: 0, action: "inspect component tree" },
      { index: 1, action: "identify overflow in sidebar" },
      { index: 2, action: "apply overflow-hidden fix" },
      { index: 3, action: "run tests" },
      { index: 4, action: "browser verification" },
    ],
    corrections: [
      {
        from: "overflow: scroll",
        to: "overflow: hidden",
        reason: "scroll causes layout shift on resize",
      },
    ],
  },
  result: "Fixed sidebar overflow, verified in Chrome and Firefox",
  startedAt: "2026-06-01T10:00:00Z",
  endedAt: "2026-06-01T10:30:00Z",
});

console.log(`Episode: ${result1.episodeId}`);
console.log(`New experiences: ${result1.newExperiences.length}`);
// => 可能提取出 "Use overflow-hidden instead of scroll for sidebar containers"
console.log(`Patterns: ${result1.updatedPatterns.length}`);
// => 1 个 pattern (frontend::bugfix, support=1)
```

### 10.2 第二次相似任务

```ts
const task2 = {
  id: "task_002",
  description: "Fix z-index stacking bug in modal overlay",
  domain: "frontend",
  taskType: "bugfix",
  tags: ["css", "z-index"],
};

// beforeRun — 现在能检索到第一次的经验了
const prep2 = await loop.beforeRun({ task: task2 });
console.log(prep2.promptBlock);
// => "## Relevant Past Experiences\n### 1. Use overflow-hidden..."

// Agent 执行... → afterRun
// => pattern (frontend::bugfix) support 变为 2
```

### 10.3 第三次任务 — 触发 Skill Proposal

```ts
const task3 = {
  id: "task_003",
  description: "Fix flex layout breaking in responsive grid",
  domain: "frontend",
  taskType: "bugfix",
  tags: ["css", "flexbox"],
};

const prep3 = await loop.beforeRun({ task: task3 });
// => 检索到多条相关 experiences

// Agent 执行... → afterRun
const result3 = await loop.afterRun({ ... });

console.log(result3.updatedPatterns[0].support);
// => 3 (达到 minSupport)

console.log(result3.updatedPatterns[0].promotion);
// => "candidate_skill"

console.log(result3.skillProposals.length);
// => 1

console.log(result3.skillProposals[0].title);
// => "frontend-bugfix-workflow"

// Skill 已保存为 draft:
// .exp-loop/skills/domain/frontend/frontend-bugfix-workflow/SKILL.md
```

### 10.4 第四次任务 — 使用 Skill

```ts
const task4 = {
  id: "task_004",
  description: "Fix padding inconsistency in card component",
  domain: "frontend",
  taskType: "bugfix",
};

const prep4 = await loop.beforeRun({ task: task4 });
console.log(prep4.promptBlock);
// => 包含 experiences + skill summary:
//    "## Available Skills\n- **frontend-bugfix-workflow**: ..."

// Agent 决定加载完整 skill
console.log(prep4.skillSummaries);
// => [{ id: "skill_xxx", name: "frontend-bugfix-workflow", ... }]

const skill = await prep4.loadSkill(prep4.skillSummaries[0].id);
console.log(skill.content);
// => 完整 SKILL.md 内容，包含 Workflow / Pitfalls / Verification
```

---

## 附录：依赖清单

| 包 | 生产依赖 | 开发依赖 |
|---|---------|---------|
| `@exp-loop/core` | 无（零依赖） | `vitest`, `typescript`, `tsup` |
| `@exp-loop/store-fs` | `@exp-loop/core`, `gray-matter`（解析 frontmatter） | `vitest`, `typescript`, `tsup` |
| `@exp-loop/cli` | `@exp-loop/core`, `@exp-loop/store-fs`, `commander` | `vitest`, `typescript`, `tsup` |
| `@exp-loop/adapter-mcp` | `@exp-loop/core`, `@exp-loop/store-fs`, `@modelcontextprotocol/sdk`, `zod` | `vitest`, `typescript`, `tsup` |
