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

### Design capability layers as pure logic libraries with UI shells as thin consumers
- **When:** Building a system that will have both CLI and GUI consumers; Designing packages in a monorepo where business logic needs to be shared; Refactoring from a CLI-only tool to support a desktop app or web UI; The business logic involves long-running operations that need progress reporting
- **Do:** Structure the architecture into three layers: (1) Engine layer (core types, algorithms, stores — no IO assumptions), (2) Capability layer (observer, syncer, etc. — pure logic libraries that accept dependencies via constructor/config and communicate results via return values and callback interfaces, never calling console.log or reading stdin), (3) UI layer (CLI, desktop app — thin shells that wire capability APIs to their specific IO patterns). Provide progress callbacks (onSessionStart, onComplete, onError) in the capability layer so any consumer can hook into the lifecycle without the library knowing about the UI.
- **Not:** Putting console.log or process.exit in library packages; Having the capability layer depend on specific transport (stdio, HTTP); Making the CLI the canonical way to invoke business logic instead of treating it as one consumer among many

### Use HTML comment markers for managed sections when writing to shared config files like CLAUDE.md
- **When:** Writing application output into a file that the user also edits manually; Implementing a sync/export feature that updates shared configuration files; The target file format is Markdown or another format where HTML comments are invisible to renderers; Multiple scopes (global, project) map to different output file paths
- **Do:** Use paired HTML comment markers (e.g., `<!-- exp-loop:start -->` and `<!-- exp-loop:end -->`) to delimit the application-managed section. Implement a section manager with three behaviors: (1) If markers exist, replace content between them; (2) If file exists but no markers, append the marked block after existing content with a blank line separator; (3) If file doesn't exist, create it with only the marked block. The managed content should include a timestamp footer (e.g., `_Last synced: ISO_DATE_`) for user visibility. Keep the managed section small — only summaries, not full content — to avoid bloating the file. For scoped output (global vs project), route to different file paths (e.g., `~/.claude/CLAUDE.md` for global, `./CLAUDE.md` for project). The sync operation should compare new content against existing managed section and skip writes when unchanged.
- **Not:** Overwriting the entire file with application content; Using fragile regex patterns to find and replace sections; Writing full-sized content (complete skill definitions, large datasets) into shared config files

### Use JSON-RPC over stdio with a single generic bridge command for Tauri sidecar communication
- **When:** Building a Tauri v2 app with Node.js backend logic; The backend uses node:fs or other Node.js-specific APIs that can't run in WebAssembly; You want to minimize the amount of Rust code that needs to understand business logic; The app needs real-time progress updates from long-running backend operations
- **Do:** Create a JSON-RPC over stdio protocol between Tauri and a Node.js sidecar process. On the Rust side, implement exactly three Tauri commands: start_sidecar, stop_sidecar, and rpc_call(method, params). The rpc_call command assigns an incrementing ID, writes the JSON-RPC request to the sidecar's stdin, and resolves via a pending HashMap<u64, oneshot::Sender> when the response arrives on stdout. For streaming progress, use JSON-RPC notifications (messages without an 'id' field) that the stdout reader thread routes to app.emit() as Tauri events. Bundle the Node.js API server as a single-file build (via tsup with noExternal for workspace deps) placed in a sidecar/ directory. This way, adding new API methods only requires changes to the api-server TypeScript and the React frontend — zero Rust changes.
- **Not:** Creating individual #[tauri::command] for each business operation; Using HTTP/WebSocket between Tauri and sidecar (port management and firewall issues); Having the Rust layer parse or validate business-specific request/response formats

### Normalize Unicode quote variants before string-starts-with checks in guard logic
- **When:** Implementing rule-based text classification that checks for specific word prefixes like don't, can't, won't; Processing text that may come from LLM output or rich text editors; Writing quality gates that reject or classify text based on sentiment or framing
- **Do:** Apply `.replace(/['']/g, "'")` normalization to the input string before performing starts-with or contains checks on words with apostrophes. This handles both straight quotes and Unicode curly quotes that LLMs and text editors commonly produce.

### Scaffold complete monorepo infrastructure before writing module code
- **When:** Setting up a new pnpm/npm workspace monorepo with multiple packages; Packages have cross-dependencies (e.g., store-fs depends on core); Using tsup or similar bundler that needs working TypeScript config
- **Do:** Create all package directories, package.json files, tsconfig files, tsup configs, and placeholder index.ts exports first, then run `pnpm install` and `pnpm build` to verify the entire build pipeline works end-to-end before writing any real module code. This catches workspace resolution, TypeScript path, and build ordering issues early when they're cheap to fix.
- **Not:** Writing full module implementations before verifying the build pipeline compiles placeholder exports successfully

### Ask clarifying questions before generating large implementation artifacts from ambiguous init commands
- **When:** Project has a design document but no implementation code yet; The init command doesn't specify explicit deliverables; Multiple reasonable interpretations exist for the scope of work
- **Do:** Present the user with a structured multi-choice questionnaire covering: (1) language preference for docs, (2) MVP scope boundaries, (3) desired document depth (spec only vs. spec + plan vs. spec + plan + code examples), and (4) tech stack confirmation. Write a plan file summarizing the agreed scope before producing any large artifacts. This ensures alignment before investing in a 900+ line development guide.

### Read TypeScript packages in dependency order: types → core → implementations → consumers
- **When:** When reading through a TypeScript monorepo with clearly separated packages for types, core logic, adapters/stores, and consumers
- **Do:** Read packages in dependency order: start with type definitions (types.ts), then core runtime/logic, then storage/adapter implementations, then CLI/consumer code, and finally examples. This mirrors the actual dependency graph and builds understanding incrementally.

### Explore monorepo structure systematically before diving into code
- **When:** Working with an unfamiliar monorepo project that has multiple packages with interdependencies
- **Do:** Start by listing project files excluding node_modules/dist/.git, then read the root package.json to understand the workspace structure, then examine each package's entry points (types → core logic → adapters → CLI → examples) in dependency order.

### Use file modification timestamps to identify recent changes in a project
- **When:** When exploring a project to understand its current development state and you need to quickly identify which files have been recently modified
- **Do:** Use `find . -type f -name '*.ts' -newer ./pnpm-lock.yaml` (or another reference file like package.json) to identify recently modified files, which helps focus attention on active development areas.
- **Not:** Reading every file in the project or relying solely on git log when you need a quick filesystem-level overview

_Last synced: 2026-06-09T13:55:44.994Z_
<!-- exp-loop:managed:end -->
