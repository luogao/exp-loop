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
