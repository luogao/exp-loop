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

### Verify sidecar binary rebuild after source changes
- **When:** Making changes to packages/api-server/src/ that affect the Node.js sidecar entry
- **Do:** Run `pnpm prepare-sidecar` from the desktop package directory before launching `pnpm tauri dev` to rebuild the api-server bundle into sidecar/bin.js.
- **Not:** Relying on `pnpm build` alone or expecting Tauri to detect and rebuild the sidecar bundle automatically

### Configure chokidar 'ignored' to allow directory recursion
- **When:** Configuring chokidar to watch files in subdirectories while filtering specific f
- **Do:** Use a function for the `ignored` option that checks the path type. Pass through directories (no extension in path) and only filter files that don't match the ta

### Centralize log routing in a single Zustand store with dual listeners
- **When:** Building a persistent log display in a Tauri app that aggregates logs from multi; Creating a global store that subscribes to Tauri IPC events, ensuring the subscr
- **Do:** Create a single Zustand store with an initListeners() method called once from App.tsx. The store should listen to both 'sidecar:notification' (for RPC logs) and
- **Not:** Do not attach Tauri event listeners directly in UI components—this causes duplicate subscriptions when components re-mount

### Use dual-threshold gate (idle time + accumulated volume) to control incremental LLM extraction costs
- **When:** Building any observer/ingestion pipeline that processes incremental deltas from; Implementing a polling observer that extracts experiences from actively-growing
- **Do:** Apply a dual-threshold gate before triggering LLM extraction on incremental deltas: (1) the session file must have been idle (mtime unchanged) for a configurabl
- **Not:** Calling LLM extraction on every poll cycle or every few new lines without checking whether the conversation has settled and sufficient content has accumulated.

### 使用本地相似度预筛选，限制传入LLM经验数量
- **When:** 进行增量经验提取且需要为LLM提供现有经验上下文时
- **Do:** 在调用LLM前，用基于词法重叠的相似度函数筛选Top‑K最相似经验作为上下文传入，并信任LLM返回的update/merge提示，不再用guard覆盖。
- **Not:** 避免将全量同范围经验直接传入LLM，尤其在经验库超过十几条后会导致提示词膨胀。

### 双门槛触发增量提取
- **When:** 活跃会话持续增量提取时
- **Do:** 仅当文件空闲≥N秒且新增行数≥M时触发LLM增量提取
- **Not:** 避免每次文件增长就立即触发提取，也不要只依赖单一条件（如只靠时间或只靠行数）。

### Union all evidence and metadata when merging duplicate experiences
- **When:** Writing a `mergeInto` or update function that folds a duplicate candidate into a
- **Do:** In the merge implementation, take the set union of the candidate’s `sourceEpisodeIds`, `evidence`, and `triggers` with the existing experience’s corresponding f
- **Not:** Merging by only updating `sourceEpisodeIds` and ignoring `evidence` or `triggers`; that discards potentially useful context captured by the extractor.

### 在 LLM 重写输出中结合 JSON 正则提取与硬截断以确保压缩
- **When:** 使用 LLM 进行结构化数据生成时; 期望输出 JSON 但可能得到额外内容
- **Do:** 解析 LLM 输出时先用正则 /\{[\s\S]*\}/ 捕获第一个 JSON 块，解析后对关键字段（如 problem ≤120, recommendation ≤160, triggers ≤4, applyWhen 每项 ≤80）执行硬截断（.slice(0, max)），确保最终数据符合规范，不受 LLM 行为

### Use local similarity as the authoritative dedup signal, not LLM routing hints
- **When:** Building an experience extraction pipeline where an LLM classifies candidates as; Seeing duplicate experiences accumulate despite having a merge path
- **Do:** Make local similarity (e.g., cosine/Jaccard on title+problem+recommendation) the authoritative merge gate. For each candidate, compute its top-1 match against t
- **Not:** Relying on the LLM's self-reported action ("new" vs "merge") as the sole or primary routing signal. LLMs frequently misclassify near-duplicates as new, especially when minor wording differences exist.

### Pre-screen candidate experiences with cheap local similarity before sending to LLM for routing
- **When:** Building any system where the LLM must compare new content against a growing cor; The experience store grows beyond ~10 active experiences per scope, and delta ex
- **Do:** Implement a local similarity pre-screening step using token-based Dice coefficient over title, triggers, recommendation, and problem fields. Rank all existing s
- **Not:** Passing the entire experience store (or any unbounded list) to the LLM prompt for routing decisions, which causes linear cost growth and eventual context overflow.

### Implement persistent log capture with dual event streams
- **When:** Building a Tauri desktop app with a Node.js sidecar where users need visibility; Implementing a persistent log panel for a sidecar process where logs need metada
- **Do:** Create a stderr reader thread in Rust's sidecar.rs that emits 'sidecar:stderr' Tauri events for each line. In the frontend, build a Zustand store with dual list
- **Not:** Do not rely only on transient console logs or stdout-based notifications for user-facing visibility

### Wrap async file-system initialization in race with timeout
- **When:** Implementing RPC methods that start background file system watchers or services
- **Do:** When initializing file-system watchers or blocking I/O within an RPC handler, race the start promise against a timeout promise (e.g., 5 seconds) using `Promise.
- **Not:** Do not await the full initialization of file watchers without a timeout in synchronous RPC paths.

### Externalize SDK Dependencies in ESM Bundles to Prevent require() Failures
- **When:** Building a Node.js CLI or library to ESM format with a bundler, and the project
- **Do:** Mark third-party SDKs (especially those wrapping native APIs like Anthropic, OpenAI, or AWS) as external in your bundler config so they remain required at runti

### Provide Full-Scope Experiences to LLM for Deduplication in Incremental Delta Extraction
- **When:** Building or debugging an experience extraction pipeline that processes long-runn; Building an experience extraction pipeline that processes incremental deltas fro
- **Do:** Retrieve all existing experiences in the target scope (e.g., all 'project' experiences) and include them in the LLM's routing prompt for delta extraction, not j

### Trace Scope Filter Propagation End-to-End When Scoped View Counts Seem Wrong
- **When:** Debugging a situation where a UI element filtered by project or scope shows stal
- **Do:** When a scoped display (e.g., "Project A has 0 experiences") contradicts the global overview, verify the entire processing pipeline: (1) the trigger (file-watche

### Use a Lightweight CLI Tool to Bypass Complex IPC Layers When Debugging Core Logic
- **When:** When a GUI application depends on a backend service or sidecar that is hard to d
- **Do:** When core business logic (like session observation and experience extraction) is functioning correctly in tests but failing in the full app due to IPC/bridge co

### Prefer Simple Polling Over Event-Driven Architectures for Background Tools
- **When:** Building a background tool with acceptable 15-60s polling latency.; Long-running CLI monitor where reliability > real-time reactivity.
- **Do:** Prefer a simple setInterval polling loop (15–60s) over watchers or IPC for background processing unless sub-second reactivity is required.

### Write Unit Tests for Incremental Processing with Mutable Fixtures and Watermark Assertions
- **When:** Building a system that processes append-only data with line-offset or message-co
- **Do:** Use mutable in-memory arrays as test fixtures that can be pushed to between observe() calls. Structure tests in three phases: (1) initial full-parse verifies wa

### Provide a resetProcessed Escape Hatch in Watermark-Based Incremental Processing Systems
- **When:** Building an incremental processing pipeline where sessions are tracked by waterm
- **Do:** Add a `resetProcessed(sessionId)` method on the observer that deletes the session's record from the processed tracking store, and expose it as a CLI command (e.

### Batch-deduplicate an experience store using union-find clustering on local similarity scores with a keep-primary merge strategy
- **When:** Maintaining an experience/knowledge store that has grown organically and accumul; The experience library has grown to dozens of entries and manual inspection reve
- **Do:** Run a batch deduplication pass that: (1) computes pairwise local similarity scores across all active experiences within the same scope; (2) uses union-find to c
- **Not:** Leaving duplicates in the store indefinitely, which silently degrades retrieval and routing quality while increasing downstream LLM prompt costs for every future delta extraction.

_Last synced: 2026-06-17T06:45:19.521Z_
<!-- exp-loop:managed:end -->
