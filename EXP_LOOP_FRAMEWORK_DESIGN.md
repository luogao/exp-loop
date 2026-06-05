# exp-loop Framework Design

## 1. Overview

`exp-loop` is a framework-agnostic experience and skill loop runtime for self-improving AI agents.

It originated from the Data Claw agent practice, where agents continuously accumulated reusable execution experience from completed tasks and injected relevant lessons into future tasks. The same pattern was later reproduced in `dialog-mamager` and `ai-native-workflow`, which showed that the mechanism is not limited to one business domain.

English positioning:

> A framework-agnostic experience and skill loop for self-improving AI agents.

Chinese positioning:

> 让 AI Agent 把每次任务沉淀为可复用经验，并在稳定重复后升级为专用 Skill。

`exp-loop` does not replace LangChain, LangGraph, CrewAI, AutoGen, Claude Code, Codex, or any custom agent runtime. It runs beside them as a learning layer.

```text
User Task
  -> Agent Runtime
  -> Task Result + Trace + Artifacts
  -> exp-loop
  -> Experience Extraction / Validation / Storage
  -> Pattern Mining / Skill Distillation
  -> Next Similar Task
  -> Experience Retrieval / Skill Loading / Prompt Injection
```

## 2. Core Idea

The core lifecycle is:

```text
Episode -> Experience -> Pattern -> Skill -> Evolution
```

Meaning:

- **Episode**: one full task execution trajectory.
- **Experience**: a reusable lesson extracted from one or more episodes.
- **Pattern**: a stable repeated task structure or failure mode observed across episodes.
- **Skill**: an executable operating procedure distilled from stable patterns.
- **Evolution**: the process of patching, merging, splitting, deprecating, and evaluating experiences and skills over time.

The design principle:

```text
Experience recommends what to do (framed from past mistakes).
Skill captures complete workflows.
Evaluation decides what survives.
```

## 3. Relationship To Existing Agent Memory Systems

Many open-source projects provide agent memory or stateful agent runtimes:

- Mem0 focuses on a general memory layer for AI applications.
- Letta / MemGPT focuses on stateful agents with editable memory blocks.
- LangGraph Memory and LangMem focus on long-term memory inside the LangChain ecosystem.
- CrewAI Memory focuses on memory scopes for CrewAI agents.
- Graphiti / Zep and Cognee focus on graph memory and temporal knowledge.
- Hermes Agent adds a learning loop that can turn repeated workflows into `SKILL.md` files and improve skills from future feedback.

`exp-loop` should not compete as another generic memory store. Its sharper role is:

> A procedural experience lifecycle for task-oriented agents.

The main distinction:

- Memory stores facts, preferences, and context.
- Experience stores positive recommendations derived from past execution (what to do, not what to avoid).
- Skill stores reusable workflows and verification procedures.

## 4. Goals

`exp-loop` should:

- Work with most agent frameworks through before/after hooks.
- Capture task episodes without taking over the agent loop.
- Extract reusable experiences from completed tasks.
- Validate, deduplicate, merge, and scope experiences.
- Retrieve relevant experiences before future tasks.
- Inject experiences into prompts or structured context.
- Mine repeated patterns from episodes and experiences.
- Distill stable patterns into dedicated skills.
- Load skills progressively to control context cost.
- Track whether an experience or skill actually helped.
- Support human-readable Markdown assets.
- Support pluggable storage and retrieval backends.

## 5. Non-Goals

The first versions should not:

- Implement a full agent orchestration framework.
- Bind to one model provider or agent SDK.
- Require a vector database.
- Store every conversation message by default.
- Replace RAG.
- Replace user/project memory.
- Execute tools directly.
- Manage sandboxing, credentials, deployment, or CI/CD.
- Train model weights.
- Put Data Claw, Dialog Manager, or any domain-specific knowledge into core.

## 6. Architecture

```text
                    ┌───────────────────────┐
                    │   Agent Runtime        │
                    │ LangChain/CrewAI/etc.  │
                    └───────────┬───────────┘
                                │
                    beforeRun() │ afterRun()
                                │
┌───────────────────────────────▼───────────────────────────────┐
│                            exp-loop                            │
│                                                               │
│  Runtime Hooks                                                │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │ SkillMatcher │ → │ ExpRetriever │ → │ ContextInjector  │   │
│  └──────────────┘   └──────────────┘   └──────────────────┘   │
│                                                               │
│  Learning Pipeline                                            │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │ EpisodeStore │ → │ ExpExtractor │ → │ ExpGuard         │   │
│  └──────────────┘   └──────────────┘   └─────────┬────────┘   │
│                                                   │           │
│                                      ┌────────────▼───────┐   │
│                                      │ ExperienceStore    │   │
│                                      └────────────┬───────┘   │
│                                                   │           │
│                                      ┌────────────▼───────┐   │
│                                      │ PatternMiner       │   │
│                                      └────────────┬───────┘   │
│                                                   │           │
│                                      ┌────────────▼───────┐   │
│                                      │ SkillDistiller     │   │
│                                      └────────────┬───────┘   │
│                                                   │           │
│                                      ┌────────────▼───────┐   │
│                                      │ SkillRegistry      │   │
│                                      └────────────┬───────┘   │
│                                                   │           │
│                                      ┌────────────▼───────┐   │
│                                      │ SkillEvolver       │   │
│                                      └────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

## 7. Asset Model

### 7.1 Task

A task is the user-visible unit of work.

```ts
type Task = {
  id: string;
  title?: string;
  description: string;
  domain?: string;
  taskType?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};
```

### 7.2 Episode

An episode is the complete record of one task execution.

```ts
type Episode = {
  id: string;
  task: Task;
  agent?: AgentInfo;
  status: "success" | "failure" | "partial";
  trace: ExecutionTrace;
  result?: unknown;
  artifacts?: ArtifactRecord[];
  startedAt: string;
  endedAt: string;
};
```

Episodes are used for retrospective analysis, pattern mining, skill evaluation, and audit. They should not be directly injected into prompts by default.

### 7.3 ExecutionTrace

```ts
type ExecutionTrace = {
  steps: TraceStep[];
  toolCalls?: ToolCallRecord[];
  errors?: ErrorRecord[];
  decisions?: DecisionRecord[];
  corrections?: CorrectionRecord[];
  verifications?: VerificationRecord[];
};
```

Trace design should capture why the agent changed course, not only what happened.

### 7.4 Experience

An experience is a reusable, positively-framed recommendation.

```ts
type Experience = {
  id: string;
  title: string;
  domain?: string;
  taskType?: string;
  scope: "global" | "domain" | "project";
  triggers: string[];
  problem: string;
  diagnosis?: string;
  recommendation: string;
  applyWhen: string[];
  avoid?: string[];
  examples?: string[];
  evidence?: string[];
  sourceEpisodeIds: string[];
  confidence: number;
  status: "active" | "draft" | "deprecated";
  createdAt: string;
  updatedAt: string;
};
```

Experience answers:

```text
When this kind of situation appears, what should the agent do?
```

The `recommendation` field is the core of an experience — it must be a positive, actionable instruction ("Use X", "Apply Y", "Verify with Z"). The `avoid` field is optional supplementary context, not the primary guidance.

Good experiences include:

- Correct tool usage patterns and API idioms.
- Effective workarounds for known constraints.
- Stable project conventions.
- Verification steps that proved valuable.
- User corrections reframed as the correct approach.

Bad experiences include:

- Temporary task progress.
- One-off logs.
- PR numbers.
- Stale URLs.
- Raw secrets.
- Guesses without evidence.
- Broad advice with no applicability boundary.

### 7.5 Pattern

A pattern is a repeated structure observed across episodes.

```ts
type Pattern = {
  id: string;
  domain?: string;
  taskType?: string;
  signature: string;
  matchedEpisodeIds: string[];
  commonSteps: string[];
  commonTools?: string[];
  recurringFailures?: string[];
  successRate: number;
  support: number;
  confidence: number;
  promotion: "none" | "candidate_skill" | "existing_skill_patch";
};
```

Pattern exists as a buffer between Experience and Skill. This prevents the system from creating low-quality skills from a single lucky task.

### 7.6 Skill

A skill is an executable operating manual for a recurring task class.

```ts
type Skill = {
  id: string;
  name: string;
  description: string;
  domain?: string;
  taskType?: string;
  scope: "global" | "domain" | "project";
  triggers: string[];
  version: string;
  status: "draft" | "active" | "deprecated";
  sourcePatternIds: string[];
  sourceExperienceIds: string[];
  path?: string;
  createdAt: string;
  updatedAt: string;
};
```

Skill answers:

```text
When this type of task appears, what complete workflow should the agent follow?
```

### 7.7 Usage

Usage records whether retrieved assets were actually useful.

```ts
type ExperienceUsage = {
  experienceId: string;
  episodeId: string;
  matchedAt: string;
  injected: boolean;
  used?: boolean;
  outcome?: "helped" | "neutral" | "harmful" | "unknown";
  notes?: string;
};

type SkillUsage = {
  skillId: string;
  episodeId: string;
  matchedAt: string;
  loaded: boolean;
  followed?: boolean;
  verified?: boolean;
  outcome?: "helped" | "neutral" | "harmful" | "unknown";
  notes?: string;
};
```

## 8. Lifecycle

### 8.1 beforeRun

Before the external agent runs:

```text
1. Classify task domain, task type, and intent signature.
2. Match relevant skill summaries.
3. Retrieve relevant experiences.
4. Render prompt or structured context.
5. Return context to the external agent runtime.
```

```ts
const prep = await loop.beforeRun({
  task,
  agent,
  project,
});
```

Result:

```ts
type BeforeRunResult = {
  promptBlock: string;
  experiences: Experience[];
  skillSummaries: SkillSummary[];
  loadSkill: (id: string) => Promise<SkillContent>;
};
```

### 8.2 Agent Execution

The external agent executes the task. `exp-loop` does not own tool calling, planning, sandboxing, or final response generation.

### 8.3 afterRun

After the task completes:

```text
1. Save the episode.
2. Extract experience candidates from task, trace, result, and artifacts.
3. Run experience guard for quality, dedupe, merge, and scope.
4. Save accepted experiences.
5. Update repeated patterns.
6. Propose new skills or skill patches.
7. Record experience and skill usage outcomes.
```

```ts
const learning = await loop.afterRun({
  task,
  result,
  trace,
  artifacts,
});
```

Result:

```ts
type AfterRunResult = {
  episodeId: string;
  experiences: Experience[];
  rejectedExperiences: RejectedExperience[];
  patterns: Pattern[];
  skillProposals: SkillProposal[];
  skillPatches: SkillPatch[];
};
```

## 9. Experience Layer

### 9.1 Experience Extraction

`ExpExtractor` produces `ExperienceCandidate[]` from an episode.

Extraction principles:

- Extract actionable, positive recommendations, not raw facts or prohibitions.
- Frame each experience as "what to do", with "what to avoid" as optional context.
- Prefer recommendations with direct evidence.
- Include applicability boundaries.
- Avoid saving temporary task state.
- Avoid saving raw secrets.

Candidate schema:

```ts
type ExperienceCandidate = {
  title: string;
  domain?: string;
  taskType?: string;
  scope?: "global" | "domain" | "project";
  triggers: string[];
  problem: string;
  diagnosis?: string;
  recommendation: string;
  applyWhen: string[];
  avoid?: string[];
  evidence?: string[];
  confidence: number;
};
```

### 9.2 Experience Guard

`ExpGuard` decides whether a candidate can enter the experience store.

```ts
type GuardResult = {
  decision: "accept" | "reject" | "merge" | "revise";
  reason: string;
  duplicateOf?: string;
  revisedCandidate?: ExperienceCandidate;
};
```

Reject conditions:

- No `applyWhen`.
- No actionable recommendation (or purely negative recommendation without a positive action).
- No evidence.
- Over-generalized advice.
- Duplicate of existing experience.
- Temporary data.
- Secret or sensitive data leakage.
- Wrong scope.

### 9.3 Experience Retrieval

Retrieval should be hybrid, not embedding-only.

Useful signals:

- `domain`
- `taskType`
- tags
- tool name
- error signature
- table name
- file path
- component name
- API name
- trigger keywords
- semantic similarity
- recency
- historical usefulness

```ts
interface ExpRetriever {
  retrieve(query: RetrieveInput): Promise<Experience[]>;
}
```

### 9.4 Experience Injection

The injector renders experiences into a format that the target agent can consume.

Default Markdown format:

```md
## Relevant Past Experiences

### 1. Use CTE for Spark SQL window + aggregate composition

When:
- Writing Spark SQL with aggregate functions; Using AVG(...) OVER() inside SUM/COUNT

Do: Move the window function result into a separate CTE, then reference the computed scalar in the aggregate layer

Not: Placing window functions directly inside aggregate expressions
```

Other supported formats should include:

- Markdown
- XML-like blocks
- JSON
- system prompt section
- tool context object

## 10. Pattern Mining

`PatternMiner` looks across episodes and experiences to detect repeated task structures.

It should answer:

- Has this task type appeared repeatedly?
- Are the traces structurally similar?
- Is there a stable successful workflow?
- Is there a stable failure mode?
- Are there common tools, steps, and verification actions?
- Should this become a new skill?
- Should this patch an existing skill?

Default promotion gate:

```text
same signature appears >= 3 times
successful episodes >= 2
stable step sequence exists
clear verification actions exist
average related experience confidence >= 0.75
no severe harmful usage
```

This gate should be configurable.

## 11. Skill Layer

### 11.1 Skill Distillation

`SkillDistiller` turns stable patterns into `SkillProposal`.

```ts
type SkillProposal = {
  id: string;
  title: string;
  reason: string;
  sourcePatternId: string;
  sourceExperienceIds: string[];
  proposedSkill: SkillDraft;
  confidence: number;
  status: "pending_review" | "auto_approved";
};
```

The first version should default to draft creation, not automatic activation.

### 11.2 Skill File Format

Default skill format is Markdown with frontmatter, compatible with common `SKILL.md` ecosystems.

```md
---
name: data-claw-sql-analysis
description: Use when analyzing Data Claw SQL/XQL tasks and producing reliable reports.
domain: data-analysis
taskType: sql-debug
triggers:
  - xql analysis
  - spark sql
  - experiment report
version: 0.1.0
status: active
sourceExperiences:
  - exp_sql_001
  - exp_sql_002
---

## When To Use

Use this skill when the task requires writing, debugging, or validating Spark SQL/XQL queries for business analysis reports.

## Workflow

1. Clarify the target metric and time window.
2. Inspect table schema before writing SQL.
3. Run a small sample query.
4. Validate join key namespace and hit rate.
5. Run the full query.
6. Parse outputs with null-safe helpers.
7. Generate the report.
8. Verify all expected artifacts exist and are non-empty.

## Common Pitfalls

- Verify `shunt_id` namespace before joining — it may differ from `user_id`.
- Use `props['key']` map-access syntax instead of `get_json_object` for MAP-typed columns.
- Gate AB significance conclusions on minimum exposure threshold — block analysis when exposure is near zero.

## Verification

- Confirm data files exist.
- Confirm final report exists.
- Confirm zero-row results are explained.
- Confirm conclusions are blocked when data linkage is broken.

## Examples

...
```

### 11.3 Skill Promotion Rules

One successful task should usually create an experience, not a skill.

Skill creation requires a repeated, stable workflow:

```text
same domain + taskType + intent signature
>= 3 matching episodes
>= 2 successful episodes
stable workflow steps
known pitfalls
explicit verification
reasonable context size
no harmful usage trend
```

### 11.4 Progressive Skill Loading

To support most agent frameworks and control token cost, skills should load progressively.

Stage 1: only inject summaries.

```md
## Available Skills

- data-claw-sql-analysis
  Use when writing or debugging Spark SQL/XQL analysis tasks.

- popup-experiment-review
  Use when reviewing popup deployment or experiment results.
```

Stage 2: load full skill only when selected.

```ts
const skill = await loop.loadSkill("data-claw-sql-analysis");
```

This can map to:

- tool call
- MCP tool
- LangGraph node
- CrewAI callback
- Claude Code skill
- Codex skill
- plain prompt construction

### 11.5 Skill Patch

When a skill is used and the episode reveals a better procedure, `SkillEvolver` should propose a patch instead of rewriting the whole skill.

```ts
type SkillPatchKind =
  | "add_pitfall"
  | "add_step"
  | "revise_step"
  | "add_verification"
  | "remove_stale_content"
  | "split_skill"
  | "deprecate_skill";

type SkillPatch = {
  id: string;
  skillId: string;
  kind: SkillPatchKind;
  sourceEpisodeId: string;
  reason: string;
  diff: string;
  risk: "low" | "medium" | "high";
  status: "pending_review" | "approved" | "rejected" | "applied";
  createdAt: string;
};
```

Skill patches must be auditable and reversible.

## 12. Guardrails

### 12.1 Experience Guardrails

Reject or revise experiences that:

- Lack applicability boundaries.
- Lack evidence.
- Are too broad to guide behavior.
- Duplicate existing experiences.
- Store temporary task progress.
- Include secrets or sensitive data.
- Are purely negative (only say what to avoid without providing a positive recommendation).

### 12.2 Skill Guardrails

Reject or keep skill proposals in draft when:

- The task pattern has not repeated.
- The workflow is unstable.
- No verification step exists.
- The skill overlaps heavily with an existing skill.
- The content exceeds size limits.
- The skill contains project-specific data but is marked global.
- The skill drifts from its stated purpose.

Recommended default limit:

```text
SKILL.md <= 15KB
description <= 500 chars
```

### 12.3 Evolution Guardrails

Skill evolution must:

- Produce a diff.
- Record source episode IDs.
- Support rollback.
- Avoid overwriting human edits silently.
- Require human review for team/project scope by default.
- Preserve semantic purpose.
- Track whether the patch improves future outcomes.

## 13. Storage Design

Default local-first structure:

```text
.exp-loop/
  config.json

  episodes/
    2026/
      episode_xxx.json

  experiences/
    global/
      exp_xxx.md
    domain/
      data-analysis/
        exp_xxx.md
    project/
      data-claw/
        exp_xxx.md

  patterns/
    pattern_xxx.json

  skills/
    global/
      research-report/
        SKILL.md
        meta.json
    domain/
      data-analysis/
        data-claw-sql-analysis/
          SKILL.md
          meta.json
    project/
      dialog-mamager/
        popup-experiment-review/
          SKILL.md
          meta.json

  patches/
    patch_xxx.json

  usage/
    experience-usage.jsonl
    skill-usage.jsonl
```

## 14. Store Interfaces

```ts
interface EpisodeStore {
  save(episode: Episode): Promise<void>;
  get(id: string): Promise<Episode | null>;
  search(query: EpisodeQuery): Promise<Episode[]>;
}

interface ExperienceStore {
  get(id: string): Promise<Experience | null>;
  list(query?: ExpListQuery): Promise<Experience[]>;
  save(exp: Experience): Promise<void>;
  update(id: string, patch: Partial<Experience>): Promise<void>;
  search(query: RetrieveInput): Promise<Experience[]>;
  markUsed(usage: ExperienceUsage): Promise<void>;
}

interface PatternStore {
  save(pattern: Pattern): Promise<void>;
  search(query: PatternQuery): Promise<Pattern[]>;
}

interface SkillRegistry {
  list(query: SkillQuery): Promise<SkillSummary[]>;
  load(id: string): Promise<SkillContent>;
  saveDraft(proposal: SkillProposal): Promise<void>;
  applyPatch(patch: SkillPatch): Promise<void>;
  markUsed(usage: SkillUsage): Promise<void>;
}
```

Default implementations:

- `FileSystemEpisodeStore`
- `FileSystemExperienceStore`
- `FileSystemSkillRegistry`
- `SQLiteStore`

Future adapters:

- Postgres / pgvector
- Elasticsearch / OpenSearch
- Mem0
- LangGraph Store
- Graphiti
- S3 / OSS
- Git-backed Markdown repo

## 15. Runtime API

```ts
interface ExpLoopRuntime {
  beforeRun(input: BeforeRunInput): Promise<BeforeRunResult>;
  afterRun(input: AfterRunInput): Promise<AfterRunResult>;

  retrieveExperiences(input: RetrieveInput): Promise<Experience[]>;
  listSkills(input: SkillListInput): Promise<SkillSummary[]>;
  loadSkill(id: string): Promise<SkillContent>;

  proposeSkill(input: ProposeSkillInput): Promise<SkillProposal>;
  applySkillPatch(input: ApplySkillPatchInput): Promise<Skill>;
}
```

Typical usage:

```ts
const loop = createExpLoop({
  stores,
  retriever,
  extractor,
  guard,
  patternMiner,
  skillDistiller,
  injector,
});

const prep = await loop.beforeRun({
  task,
  agent: { name: "data-analysis-agent" },
  project: "data-claw",
});

const result = await agent.run({
  task,
  context: prep.promptBlock,
});

await loop.afterRun({
  task,
  result,
  trace,
  artifacts,
});
```

## 16. Adapter Design

`exp-loop` should support different agent environments through thin adapters.

Initial adapters:

- Plain TypeScript SDK.
- CLI.
- MCP Server.
- LangGraph adapter.
- CrewAI callback adapter.
- Claude Code / Codex skill exporter.

### 16.1 MCP Server

MCP tools:

```text
retrieve_experiences
list_skills
load_skill
record_episode
propose_experience
propose_skill
apply_skill_patch
mark_usage
```

This lets any MCP-compatible agent use `exp-loop` without direct SDK integration.

### 16.2 LangGraph

Use `beforeRun` as a pre-node and `afterRun` as a post-node:

```ts
state.expLoop = await loop.beforeRun({ task: state.task });

// agent nodes run here

await loop.afterRun({
  task: state.task,
  result: state.result,
  trace: state.trace,
});
```

### 16.3 CrewAI

Use task callbacks:

```ts
beforeTask: async (task) => loop.beforeRun({ task }),
afterTask: async (task, output) => loop.afterRun({ task, result: output }),
```

### 16.4 Claude Code / Codex / Custom Agents

Call `beforeRun` during prompt construction and `afterRun` before finishing the task.

## 17. CLI Design

```bash
exp-loop init
exp-loop search "Spark SQL window aggregate error"
exp-loop validate ./experiences
exp-loop extract --episode episode.json
exp-loop patterns
exp-loop skills list
exp-loop skills propose --pattern pattern_xxx
exp-loop skills diff patch_xxx
exp-loop skills apply patch_xxx
exp-loop stats
```

CLI should make the system easy to inspect and audit.

## 18. Configuration

```json
{
  "store": {
    "type": "filesystem",
    "path": ".exp-loop"
  },
  "retrieval": {
    "topK": 5,
    "strategy": "hybrid"
  },
  "guard": {
    "dedupe": true,
    "minConfidence": 0.7
  },
  "patterns": {
    "minSupport": 3,
    "minSuccessCount": 2,
    "minConfidence": 0.75
  },
  "skills": {
    "autoApprove": false,
    "maxSkillBytes": 15360,
    "progressiveLoading": true
  },
  "injection": {
    "format": "markdown",
    "maxExperiences": 5,
    "maxSkillSummaries": 8
  }
}
```

## 19. Metrics

### 19.1 Experience Metrics

- Total experiences.
- Active / draft / deprecated experiences.
- Experience match rate.
- Experience injection rate.
- Experience adoption rate.
- Harmful experience rate.
- Duplicate rejection rate.
- Repeated error reduction.

### 19.2 Skill Metrics

- Total skills.
- Active / draft / deprecated skills.
- Skill match rate.
- Skill load rate.
- Skill followed rate.
- Skill verified rate.
- Success rate after skill usage.
- Patch frequency.
- Stale skill count.
- Average token cost.
- Reduction in user corrections after skill usage.

Core evaluation chain:

```text
Matched -> Loaded -> Followed -> Verified -> Helped
```

Without usage outcomes, the system degrades into an unbounded knowledge pile.

## 20. Package Structure

Recommended monorepo layout:

```text
exp-loop/
  packages/
    core/
      src/
        runtime.ts
        types.ts
        episode.ts
        extractor.ts
        guard.ts
        retriever.ts
        injector.ts
        pattern-miner.ts
        skill-distiller.ts
        skill-evolver.ts
        stores.ts

    store-fs/
    store-sqlite/
    adapter-mcp/
    adapter-langgraph/
    adapter-crewai/
    cli/

  examples/
    data-claw-style/
    dialog-manager-style/
    coding-agent/

  docs/
    concepts.md
    experience-schema.md
    skill-schema.md
    adapters.md
    guardrails.md
```

## 21. MVP Roadmap

### v0.1 Experience Loop

- Episode recording.
- Markdown experience store.
- Experience extractor.
- Experience guard.
- Hybrid retriever.
- Markdown prompt injector.
- Usage tracking.
- CLI init/search/validate.
- Data Claw style example.

### v0.2 Skill Distillation

- Pattern miner.
- Skill proposal.
- `SKILL.md` generation.
- Skill registry.
- Progressive skill loading.
- Skill usage tracking.
- CLI skills list/propose/diff.

### v0.3 Skill Evolution

- Skill patch.
- Skill guard.
- Review workflow.
- Patch apply/rollback.
- Skill deprecation.
- Skill splitting.

### v0.4 Ecosystem

- MCP server.
- LangGraph adapter.
- CrewAI adapter.
- Mem0 / Graphiti / pgvector backend.
- Codex / Claude Code skill exporter.
- Lightweight dashboard.

## 22. Design Principles

1. **Experience before Skill**
   Capture small lessons first, then promote repeated stable patterns into skills.

2. **A Skill must come from repetition**
   One successful task is not enough for an active skill by default.

3. **Skill is a workflow, not a knowledge dump**
   A skill must include when-to-use, workflow, pitfalls, and verification.

4. **Progressive loading by default**
   Load summaries first, full content only when relevant.

5. **All evolution is auditable**
   Every skill patch needs a diff, source episode, reason, and rollback path.

6. **Business knowledge stays outside core**
   Data Claw, Dialog Manager, and AI Native Workflow knowledge belongs to project/domain assets, not the core package.

7. **Evaluation decides retention**
   Assets that are never useful should be deprecated or pruned.

8. **Human-readable assets matter**
   Markdown is a first-class format because teams need to inspect, edit, review, and share experiences and skills.

## 23. Example: Data Claw Style Flow

```text
Task: Analyze an experiment with Spark SQL and produce a report.

Episode:
- Agent writes SQL.
- Query fails because props is MAP<STRING, STRING>.
- Agent corrects query from get_json_object(props, '$.dialogId') to props['dialogId'].
- Final report is generated and verified.

Experience:
- Title: Use map access for app_xlog props fields
- When: querying dwd.app_xlog_1_ubt_* tables
- Do: Use props['dialogId'] map-access syntax for MAP-typed columns
- Not: get_json_object(props, ...)

Pattern:
- Multiple SQL analysis episodes require schema inspection, small-sample validation, full query, report generation, and artifact verification.

Skill:
- data-claw-sql-analysis
- Includes full workflow, common pitfalls, and verification checklist.
```

## 24. Example: Dialog Manager Style Flow

```text
Task: Review a popup deployment result.

Episode:
- Agent reads deployment record.
- Agent queries exposure, click, complaint, and order metrics.
- Agent detects exposure near zero.
- Agent blocks AB significance conclusion and emits red-light diagnosis.

Experience:
- Title: Gate AB conclusions on minimum exposure threshold
- When: reviewing popup experiment with exposure metrics
- Do: Check exposure count against minimum threshold before computing significance; emit red-light diagnosis and block conclusions when exposure is near zero

Pattern:
- Popup review repeatedly follows deploy record -> metrics query -> health check -> conclusion gating -> REC markdown.

Skill:
- popup-experiment-review
- Includes metric checklist, red-light gates, and REC output format.
```

## 25. Example: Coding Agent Flow

```text
Task: Fix a UI bug.

Episode:
- Agent inspects component tree.
- Agent proposes two fixes.
- Agent applies minimal patch.
- Agent runs tests and browser verification.
- Agent records outcome.

Experience:
- Title: Verify layout changes in browser after applying fix
- When: fixing layout-affecting frontend bugs
- Do: Run browser verification (not just unit tests) after applying CSS/layout patches to confirm visual correctness

Pattern:
- Bugfix tasks repeatedly use inspect -> locate -> candidate fixes -> patch -> test -> summarize.

Skill:
- frontend-bugfix-workflow
- Includes reproduction, candidate scoring, minimal patch preference, and verification requirements.
```

## 26. Summary

The complete `exp-loop` loop is:

```text
observe episode
-> extract experience
-> guard and store
-> retrieve and inject
-> mine repeated patterns
-> distill skill
-> load skill progressively
-> execute with skill
-> evaluate usage
-> evolve or deprecate
```

The value is not merely storing memory. The value is turning agent execution into durable operational improvement:

- Use **Experience** to correct repeated mistakes.
- Use **Skill** to reuse stable workflows.
- Use **Evaluation** to keep the system honest.

