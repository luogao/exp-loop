# exp-loop

A framework-agnostic experience and skill loop for self-improving AI agents.

> Let AI agents distill every task into reusable experience, and promote stable patterns into dedicated skills.

`exp-loop` does not replace LangChain, LangGraph, CrewAI, AutoGen, Claude Code, Codex, or any custom agent runtime. It runs **beside** them as a learning layer.

```
User Task
  → Agent Runtime (any framework)
  → Task Result + Trace
  → exp-loop
  → Experience Extraction → Pattern Mining → Skill Distillation
  → Next Similar Task
  → Experience Retrieval → Skill Loading → Prompt Injection
```

## Core Idea

```
Episode → Experience → Pattern → Skill → Evolution
```

- **Experience** — positive, actionable recommendations derived from past executions ("Use X when Y")
- **Skill** — complete workflows distilled from repeated successful patterns
- **Evaluation** — usage tracking decides what survives and what gets deprecated

Experience tells the agent what to do. Skill tells the agent how to do it. Evaluation keeps the system honest.

## Quick Start

```bash
# Install
pnpm install

# Run tests
pnpm test

# Build all packages
pnpm build

# Run the end-to-end demo
pnpm --filter exp-loop-basic-usage start
```

## Usage

```ts
import {
  createExpLoop,
  createExpExtractor,
  createExpGuard,
  createExpRetriever,
  createContextInjector,
  createPatternMiner,
  createSkillDistiller,
} from "@exp-loop/core";
import { createFileSystemStores } from "@exp-loop/store-fs";

// Initialize stores
const stores = createFileSystemStores(".exp-loop");

// Create the loop
const loop = createExpLoop({
  episodeStore: stores.episodeStore,
  experienceStore: stores.experienceStore,
  retriever: createExpRetriever({ store: stores.experienceStore }),
  extractor: createExpExtractor({ llm: yourLlmFunction }),
  guard: createExpGuard(),
  injector: createContextInjector({ format: "markdown" }),
  patternMiner: createPatternMiner({
    episodeStore: stores.episodeStore,
    patternStore: stores.patternStore,
  }),
  skillDistiller: createSkillDistiller({
    llm: yourLlmFunction,
    episodeStore: stores.episodeStore,
    experienceStore: stores.experienceStore,
  }),
  skillRegistry: stores.skillRegistry,
});

// Before your agent runs — retrieve relevant context
const prep = await loop.beforeRun({ task });
// prep.promptBlock  → inject into agent prompt
// prep.experiences  → matched experiences
// prep.loadSkill()  → load full skill on demand

// After your agent runs — extract and learn
const result = await loop.afterRun({
  task,
  status: "success",
  trace: executionTrace,
  result: agentOutput,
  startedAt,
  endedAt,
});
// result.newExperiences   → extracted experiences
// result.updatedPatterns  → pattern accumulation
// result.skillProposals   → auto-generated skill drafts
```

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@exp-loop/core` | Types, runtime, and all core modules | ✅ Implemented |
| `@exp-loop/store-fs` | Filesystem-based storage (Markdown + JSON) | ✅ Implemented |
| `@exp-loop/cli` | CLI tool | 🚧 Planned |
| `@exp-loop/adapter-mcp` | MCP Server adapter | 🚧 Planned |

## Architecture

```
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
│  beforeRun path                                               │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │ SkillMatcher │ → │ ExpRetriever │ → │ ContextInjector  │   │
│  └──────────────┘   └──────────────┘   └──────────────────┘   │
│                                                               │
│  afterRun path                                                │
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
│                                      └────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

## How It Works

### 1. Agent completes a task → Episode recorded

Every task execution is saved as an Episode with its trace, corrections, and outcome.

### 2. Experiences extracted → Guard filters quality

An LLM extracts reusable recommendations from each episode. The guard enforces quality:
- Must be a **positive recommendation** ("Use X"), not just a prohibition ("Don't do Y")
- Must have applicability boundaries (`applyWhen`)
- Duplicates are detected and merged conservatively

### 3. Patterns detected → Skills proposed

When the same task signature appears ≥3 times with ≥60% success rate, the pattern is promoted to a skill candidate. An LLM distills the pattern + related experiences into a `SKILL.md` with workflow, pitfalls, and verification steps.

### 4. Next similar task → Context injected

Before the agent runs, relevant experiences and skill summaries are retrieved and injected into the prompt. Skills load progressively — summaries first, full content only when needed.

## Storage

Local-first, human-readable:

```
.exp-loop/
  episodes/2026/ep_xxx.json          # Episode JSON
  experiences/global/exp_xxx.md       # Markdown + YAML frontmatter
  experiences/domain/frontend/exp_xxx.md
  patterns/pat_xxx.json               # Pattern JSON
  skills/domain/frontend/skill-name/
    SKILL.md                          # Markdown + frontmatter
    meta.json                         # Structured metadata
  usage/
    experience-usage.jsonl            # Usage tracking
    skill-usage.jsonl
```

## Design Principles

1. **Experience before Skill** — capture small lessons first, promote repeated patterns into skills
2. **Positive framing** — experiences recommend what to do, not what to avoid
3. **Skill requires repetition** — one successful task is not enough for a skill
4. **Progressive loading** — summaries first, full content only when relevant
5. **Conservative merge** — new evidence is accumulated but recommendations aren't auto-replaced until proven helpful
6. **All evolution is auditable** — every change has a source episode and rollback path
7. **Business knowledge stays outside core** — domain-specific knowledge belongs in project/domain assets

## Docs

- [Framework Design](./EXP_LOOP_FRAMEWORK_DESIGN.md) — complete design specification
- [MVP Development Guide](./MVP_DEVELOPMENT_GUIDE.md) — implementation spec with code examples

## License

MIT
