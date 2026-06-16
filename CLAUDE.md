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
- **When:** Making changes to packages/api-server/src/ that affect the Node.js sidecar entry point (bin.ts) or its dependencies
- **Do:** Run `pnpm prepare-sidecar` from the desktop package directory before launching `pnpm tauri dev` to rebuild the api-server bundle into sidecar/bin.js.
- **Not:** Relying on `pnpm build` alone or expecting Tauri to detect and rebuild the sidecar bundle automatically

### Configure chokidar 'ignored' to allow directory recursion
- **When:** Configuring chokidar to watch files in subdirectories while filtering specific file types.
- **Do:** Use a function for the `ignored` option that checks the path type. Pass through directories (no extension in path) and only filter files that don't match the target pattern (e.g., `.jsonl`). This ensures recursion works while filtering non-target files.

### Centralize log routing in a single Zustand store with dual listeners
- **When:** Building a persistent log display in a Tauri app that aggregates logs from multiple sidecar communication channels; Creating a global store that subscribes to Tauri IPC events, ensuring the subscription persists across route changes without duplication.; Creating a Zustand store that registers Tauri event listeners (listen) or other persistent callbacks; Setting up global event handlers or websockets that must stay alive for the app's entire lifetime
- **Do:** Create a single Zustand store with an initListeners() method called once from App.tsx. The store should listen to both 'sidecar:notification' (for RPC logs) and 'sidecar:stderr' (for raw lines), normalize them into a unified LogEntry type, and manage a sliding window buffer (e.g., 500 entries). Components consume only the normalized logs array.
- **Not:** Do not attach Tauri event listeners directly in UI components—this causes duplicate subscriptions when components re-mount

### Use dual-threshold gate (idle time + accumulated volume) to control incremental LLM extraction costs
- **When:** Building any observer/ingestion pipeline that processes incremental deltas from active sessions (Claude Code sessions, chat logs, CI logs) and calls an LLM for extraction or analysis.; Implementing a polling observer that extracts experiences from actively-growing session logs where LLM API costs are a concern.; Building an observer/poller that watches continuously-growing log/session files (JSONL, chat logs, etc.) and extracts experiences incrementally. The source supports incremental parsing (startLine offset), and LLM calls are a significant cost driver.; When building an observer loop that incrementally processes active conversation files to extract experiences.
- **Do:** Apply a dual-threshold gate before triggering LLM extraction on incremental deltas: (1) the session file must have been idle (mtime unchanged) for a configurable minimum period (e.g., 120 seconds), ensuring the conversation has paused; (2) the accumulated new content must exceed a minimum line count (e.g., 30 lines), ensuring there is enough substantive material. Both thresholds must be met. While deferred, do not advance the processing watermark so the delta accumulates until the gate opens.
- **Not:** Calling LLM extraction on every poll cycle or every few new lines without checking whether the conversation has settled and sufficient content has accumulated.

### 使用本地相似度预筛选，限制传入LLM的现有经验数量
- **When:** 进行增量经验提取且需要为LLM提供现有经验上下文时。
- **Do:** 在调用LLM之前，使用基于词法重叠的本地相似度函数（如标题、触发词、推荐内容的Dice系数）从同范围的全量经验中筛选出Top‑K（例如5条）最相似的条目，只将这K条作为上下文传给LLM进行路由决策。并信任LLM返回的update/merge提示，不再用guard覆盖。
- **Not:** 避免将全量同范围经验直接传入LLM，尤其在经验库超过十几条后会导致提示词膨胀。

### 使用双门槛（空闲时间 + 累积行数）控制增量提取触发
- **When:** 对活跃会话持续进行增量经验提取时。
- **Do:** 在observer层配置双门槛：会话文件自最后一次修改后需空闲至少N秒（如120秒），且自上次处理以来新增的文本行数达到M行（如30行），两个条件同时满足时才触发一次LLM增量提取。未通过时跳过，不推进水位线，让增量累积到下一次检查。
- **Not:** 避免每次文件增长就立即触发提取，也不要只依赖单一条件（如只靠时间或只靠行数）。

### Union all evidence and metadata when merging duplicate experiences
- **When:** Writing a `mergeInto` or update function that folds a duplicate candidate into an existing experience entry in a knowledge base.
- **Do:** In the merge implementation, take the set union of the candidate’s `sourceEpisodeIds`, `evidence`, and `triggers` with the existing experience’s corresponding fields, and persist the union. This preserves all accumulated evidence and trigger keywords for future retrieval.
- **Not:** Merging by only updating `sourceEpisodeIds` and ignoring `evidence` or `triggers`; that discards potentially useful context captured by the extractor.

### Use local similarity as the authoritative dedup signal, not LLM routing hints
- **When:** Building an experience extraction pipeline where an LLM classifies candidates as new/merge/update; Seeing duplicate experiences accumulate despite having a merge path; The LLM extraction prompt includes a routingHint or similar action field; Building LLM-based extraction pipelines that merge or create entries based on similarity; When LLM-generated routing or metadata is unreliable for deduplication decisions; When duplicate accumulation is observed despite LLM being asked to return merge hints; Building systems where an LLM component suggests how to incorporate incremental candidates into an existing knowledge base (e.g., experience extraction, memory updates).; Building or maintaining a system that extracts experience candidates from agent sessions and relies on an LLM to propose merge/update/new decisions, especially when the LLM is not fine‑tuned to produce consistently accurate hints.; 需要判断两条经验是否重复，或需要为候选经验寻找最匹配的现有经验时（如去重脚本、增量路由的候选筛选）。
- **Do:** Make local similarity (e.g., cosine/Jaccard on title+problem+recommendation) the authoritative merge gate. For each candidate, compute its top-1 match against the existing pool. If the similarity score exceeds a tuned threshold (e.g., 0.32), merge the candidate into that target regardless of what the LLM's routingHint says. Only treat the LLM hint as authoritative for explicit "update" actions (where the LLM is intentionally refining a specific existing entry), not for "new" vs "merge" classification.
- **Not:** Relying on the LLM's self-reported action ("new" vs "merge") as the sole or primary routing signal. LLMs frequently misclassify near-duplicates as new, especially when minor wording differences exist.

### Pre-screen candidate experiences with cheap local similarity before sending to LLM for routing
- **When:** Building any system where the LLM must compare new content against a growing corpus of existing items to decide merge, update, or creation — especially when the corpus size makes full-context prompting expensive.; The experience store grows beyond ~10 active experiences per scope, and delta extraction needs to compare candidates against the existing corpus. The routing decision (new/update/merge) is made by an LLM, but the set of candidates it sees should be capped.; Building an experience extraction pipeline where each new episode must be routed against a growing library of existing experiences and LLM prompt size is a cost factor.; When the LLM extractor needs to decide whether a new delta should update or merge into existing experiences.
- **Do:** Implement a local similarity pre-screening step using token-based Dice coefficient over title, triggers, recommendation, and problem fields. Rank all existing same-scope experiences against the incoming delta and select top-K (e.g., K=5) above a minimum similarity threshold. Pass only these K candidates to the LLM for fine-grained routing decisions (new/update/merge). Use stemmed tokens and stop-word removal to improve match quality without embeddings. For fields with different discriminative power, apply weighted blending (e.g., 0.4 title + 0.25 triggers + 0.2 recommendation + 0.15 problem).
- **Not:** Passing the entire experience store (or any unbounded list) to the LLM prompt for routing decisions, which causes linear cost growth and eventual context overflow.

### Implement persistent log capture with dual event streams
- **When:** Building a Tauri desktop app with a Node.js sidecar where users need visibility into backend operations; Implementing a persistent log panel for a sidecar process where logs need metadata for display; Building a Tauri app with a Node.js sidecar process where you need visibility into backend errors and operational logs; Building a Tauri v2+ app that uses a Node.js sidecar or any external process where stderr output is important for debugging.; Sending logs from a Node.js sidecar to a Tauri frontend via stderr events, where the UI needs to distinguish log severity or show timestamps.; Building a Tauri desktop app with a Node.js sidecar that uses stdio for JSON-RPC communication and needs to capture non-RPC stderr output.; Building a Tauri desktop app with a stdio-communicating sidecar process where stderr needs to be visible in the UI; Implementing a Tauri sidecar that needs to stream logs or error output from a Node.js child process to the Rust/Frontend; Setting up a Tauri sidecar that launches a child Node.js process and needs to expose its logs to the frontend
- **Do:** Create a stderr reader thread in Rust's sidecar.rs that emits 'sidecar:stderr' Tauri events for each line. In the frontend, build a Zustand store with dual listeners: one for 'sidecar:notification' (method='log') and one for 'sidecar:stderr'. Aggregate both streams into a single persistent log array with a sliding window cap (e.g., 500 entries) and render in a collapsible panel.
- **Not:** Do not rely only on transient console logs or stdout-based notifications for user-facing visibility

### Wrap async file-system initialization in race with timeout
- **When:** Implementing RPC methods that start background file system watchers or services with potentially slow initialization.
- **Do:** When initializing file-system watchers or blocking I/O within an RPC handler, race the start promise against a timeout promise (e.g., 5 seconds) using `Promise.race`. Allow the watcher to initialize in the background but return control to the client immediately.
- **Not:** Do not await the full initialization of file watchers without a timeout in synchronous RPC paths.

### Externalize SDK Dependencies in ESM Bundles to Prevent require() Failures
- **When:** Building a Node.js CLI or library to ESM format with a bundler, and the project depends on SDKs that may internally use `require()` for Node built-ins. Especially when the dist output is unexpectedly large (megabytes for a simple CLI) or when SDK calls fail silently with no error message.
- **Do:** Mark third-party SDKs (especially those wrapping native APIs like Anthropic, OpenAI, or AWS) as external in your bundler config so they remain required at runtime rather than inlined into the ESM bundle. In tsup, use `noExternal: []` combined with `external: ["@anthropic-ai/sdk"]` to prevent the SDK from being bundled while keeping all other deps inline. After changing externals, verify with `grep -c '<sdk-name>' dist/index.js` — a count of 0 confirms the SDK is not inlined, and the dist file size should drop significantly (e.g., from 2.2M to 18K for a single-SDK project).

### Provide Full-Scope Experiences to LLM for Deduplication in Incremental Delta Extraction
- **When:** Building or debugging an experience extraction pipeline that processes long-running sessions incrementally and uses an LLM to decide whether a candidate experience is new, an update, or a merge, where the experience store may already contain entries from other sessions.; Building an experience extraction pipeline that processes incremental deltas from multiple sessions and needs to prevent duplicate experiences from accumulating across sessions within the same scope.; Building an incremental knowledge extraction system where experiences accumulate across multiple sessions and the LLM is responsible for deduplication/routing decisions during delta processing.; Debugging why an LLM-based merge/update router consistently fails to identify cross-session duplicates despite performing well within a single session.; Building an LLM-based routing or classification system where the LLM must decide whether incoming items should be merged with or distinguished from a growing corpus that spans multiple sessions or sources.; Designing or debugging an experience extraction pipeline that processes incremental session deltas and aims to maintain a deduplicated knowledge base across multiple sessions.; Building an incremental experience‑extraction pipeline where experiences are scoped by project or domain and the user expects deduplication across all sessions within that scope.; Building an automated learning system that extracts reusable lessons from ongoing conversations, where new observations may duplicate existing lessons from any past session within the same scope.
- **Do:** Retrieve all existing experiences in the target scope (e.g., all 'project' experiences) and include them in the LLM's routing prompt for delta extraction, not just the subset linked to prior episodes from the current session. Additionally, implement a guard that uses semantic similarity (keyword/topic overlap) instead of relying solely on near-exact title string matching, to catch differently-worded duplicates.

### Trace Scope Filter Propagation End-to-End When Scoped View Counts Seem Wrong
- **When:** Debugging a situation where a UI element filtered by project or scope shows stale or zero counts while an unfiltered overview shows updated data.
- **Do:** When a scoped display (e.g., "Project A has 0 experiences") contradicts the global overview, verify the entire processing pipeline: (1) the trigger (file-watcher or API handler) must pass the scope or projectPath to the scheduler; (2) the scheduler must forward the filter to `observer.observe()`; (3) the observer must respect the filter when listing sessions; (4) the store must write experiences with the correct scope (project vs global) so that scope-aware queries return consistent results. A single missing filter argument anywhere in the chain breaks scoped views while the global aggregate appears normal.

### Use a Lightweight CLI Tool to Bypass Complex IPC Layers When Debugging Core Logic
- **When:** When a GUI application depends on a backend service or sidecar that is hard to debug due to IPC abstraction layers, and the core logic can be tested independently.
- **Do:** When core business logic (like session observation and experience extraction) is functioning correctly in tests but failing in the full app due to IPC/bridge complexity, build a standalone CLI tool that directly invokes the core modules without any IPC layer. Use the CLI's stdout/stderr for logging and a simple setInterval polling loop to replicate the watcher behavior. This isolates the core logic from the UI layer, making debugging fast and deterministic.

### Prefer Simple Polling Over Complex Event-Driven Architectures for Background Processing Tools
- **When:** Designing a background processing system (session monitor, file processor, data pipeline) that needs to detect new data over time, especially when the tool is still in early development or the primary goal is correctness over real-time latency.; Building a long-running Node.js CLI tool or daemon that monitors filesystem changes for new data, when 15-60 second polling latency is acceptable and development velocity is more important than sub-second detection speed.; Designing a Node.js CLI tool that needs to monitor a directory or external resource and react to changes, and where simplicity and guaranteed uptime are more important than sub‑second latency.; Building a CLI tool that needs to periodically check for new data and process it, where real-time response is not required and simplicity is valued over sub-second latency.; Building a Node.js CLI that must run continuously to monitor for new data, where reliability is more important than immediate event‑driven responses.
- **Do:** For background processing tools that check for new data at regular intervals (e.g., polling for new sessions, files, or events), prefer a simple `setInterval` polling loop (15-60 second interval) over filesystem watchers or event-driven IPC architectures, unless sub-second reactivity is a hard requirement. Polling is deterministic, debuggable with simple `console.log`, and platform-independent. Reserve complex architectures (watchers, IPC bridges, multi-process coordination) for cases where real-time reactivity directly unlocks user value that polling cannot provide.

### Write Unit Tests for Incremental Processing with Mutable Fixtures and Watermark Assertions
- **When:** Building a system that processes append-only data with line-offset or message-count watermarks, especially when the dedup/watermark logic has multiple code paths (full parse, delta parse, empty skip, boundary reset, legacy fallback).
- **Do:** Use mutable in-memory arrays as test fixtures that can be pushed to between observe() calls. Structure tests in three phases: (1) initial full-parse verifies watermark is set, (2) re-observe with no new data verifies empty delta produces no new episodes, (3) append data and re-observe verifies watermark advances and a delta episode is created. Additionally test boundary cases: startLine beyond file length resets to full parse, sources without supportsIncremental preserve legacy boolean-skip behavior, and resetProcessed allows full re-parse.

### Provide a resetProcessed Escape Hatch in Watermark-Based Incremental Processing Systems
- **When:** Building an incremental processing pipeline where sessions are tracked by watermarks, and users or maintainers need a way to trigger full re-processing of specific sessions without clearing all state.
- **Do:** Add a `resetProcessed(sessionId)` method on the observer that deletes the session's record from the processed tracking store, and expose it as a CLI command (e.g., `reprocess <sessionId>`) that calls resetProcessed then triggers a fresh observe pass. This gives users an explicit escape hatch without requiring them to manually edit internal JSON files.

### Batch-deduplicate an experience store using union-find clustering on local similarity scores with a keep-primary merge strategy
- **When:** Maintaining an experience/knowledge store that has grown organically and accumulated semantic duplicates — especially after changing extraction logic or before enabling cost-sensitive LLM routing that references the store.; The experience library has grown to dozens of entries and manual inspection reveals near-duplicates with slightly different wording for the same underlying lesson.
- **Do:** Run a batch deduplication pass that: (1) computes pairwise local similarity scores across all active experiences within the same scope; (2) uses union-find to cluster experiences where similarity exceeds a threshold (e.g., 0.32); (3) within each multi-item cluster, selects a primary experience (longest recommendation as the information-richest, tie-broken by confidence); (4) merges evidence, sourceEpisodeIds, applyWhen, and triggers from secondary items into the primary; (5) marks secondary items as deprecated. Expose this as a CLI command with a dry-run mode for preview before applying. Requires a store that supports status updates ('deprecated').
- **Not:** Leaving duplicates in the store indefinitely, which silently degrades retrieval and routing quality while increasing downstream LLM prompt costs for every future delta extraction.

### Build CLI browse commands (list, search, show) for direct inspection of stored experiences
- **When:** Creating a developer‑facing experience collection system where visibility into the store is needed
- **Do:** Implement exp list [--scope] [--all], exp search <keyword>, and exp show <id|index> in your CLI tool to expose the experience store in a human‑readable, grouped, and searchable way.
- **Not:** Forcing users to parse raw data directories to answer ‘what experiences do we have?’

_Last synced: 2026-06-16T09:39:07.322Z_
<!-- exp-loop:managed:end -->
