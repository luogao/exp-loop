# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`exp-loop` is a framework-agnostic experience and skill loop runtime for self-improving AI agents. It runs beside agent runtimes (LangChain, CrewAI, Claude Code, etc.) as a learning layer — not a replacement.

Core lifecycle: **Episode → Experience → Pattern → Skill → Evolution**

- **Experience** recommends what to do (positive, actionable guidance derived from past executions)
- **Skill** captures workflows (executable procedures distilled from repeated patterns)
- **Evaluation** decides what survives (usage tracking determines retention)

## Architecture

Two runtime paths connected by a learning pipeline:

**Before agent runs** (context injection):
`SkillMatcher → ExpRetriever → ContextInjector` — classifies task, retrieves relevant experiences/skills, injects into agent prompt.

**After agent runs** (learning):
`EpisodeStore → ExpExtractor → ExpGuard → ExperienceStore → PatternMiner → SkillDistiller → SkillRegistry → SkillEvolver`

The framework does NOT own tool calling, planning, sandboxing, or response generation. It only hooks into `beforeRun()` and `afterRun()`.

## Planned Package Structure

Monorepo under `packages/`:

- `core/` — runtime, types, episode, extractor, guard, retriever, injector, pattern-miner, skill-distiller, skill-evolver, stores
- `store-fs/` — filesystem store implementation
- `store-sqlite/` — SQLite store implementation
- `adapter-mcp/` — MCP server adapter
- `adapter-langgraph/` — LangGraph adapter
- `adapter-crewai/` — CrewAI callback adapter
- `cli/` — CLI tool (`exp-loop init/search/validate/extract/patterns/skills/stats`)

## Key Design Constraints

- One successful task creates an **experience**, not a skill. Skills require ≥3 matching episodes with ≥2 successes and a stable workflow.
- Skills use Markdown with YAML frontmatter (`SKILL.md`), max 15KB. Experiences are also Markdown.
- Progressive skill loading: inject summaries first, full content only when selected.
- All skill evolution produces a diff, records source episodes, and supports rollback.
- Business/domain knowledge (Data Claw, Dialog Manager, etc.) belongs in project/domain assets, never in core.
- Storage is local-first under `.exp-loop/`, organized by scope (`global/`, `domain/`, `project/`).

## Asset Hierarchy

Experiences and skills are scoped: `global > domain > project`. Experiences must be framed as **positive recommendations** ("Use X", "Apply Y") — purely negative experiences ("Don't do X") are rejected by the guard. The `avoid` field is optional supplementary context, not the primary guidance. See `EXP_LOOP_FRAMEWORK_DESIGN.md` sections 9.2 and 12 for full guardrail rules.

## Reference

The complete design spec is in `EXP_LOOP_FRAMEWORK_DESIGN.md` — consult it for type definitions, store interfaces, adapter patterns, configuration schema, and the MVP roadmap (v0.1 Experience Loop → v0.2 Skill Distillation → v0.3 Skill Evolution → v0.4 Ecosystem).

<!-- exp-loop:managed:start -->
## Learned Experiences

### Verify Data Flow by Cross-Referencing Code and File System
- **When:** Trying to understand where evaluation data comes from or if real data is used.
- **Do:** Use 'find' for data files (json, csv) and 'grep' for data-loading variables (data_path, data_dir), then check .gitignore and README to confirm data origin and availability.
- **Not:** Do not assume data exists just because a data-loading function is called; verify file presence.

### Leverage Recent Commits to Focus Feature Discovery
- **When:** The user asks whether a feature exists and references recent activity or when you want to quickly assess recent additions.
- **Do:** Start by checking recent Git log for commits matching the feature keywords to narrow the scope of code inspection.
- **Not:** Avoid searching the entire codebase blindly without first narrowing scope via commit history.

### Use Explore Subagent for Multi-Faceted Codebase Investigations
- **When:** You need to thoroughly survey a large codebase for a feature that might span multiple modules.
- **Do:** Dispatch an Explore subagent with a focused prompt to search across directories, read source files, and correlate patterns for comprehensive analysis.
- **Not:** Avoid manually exploring dozens of files when an automated subagent can parallelize discovery.

_Last synced: 2026-06-16T03:22:53.574Z_
<!-- exp-loop:managed:end -->
