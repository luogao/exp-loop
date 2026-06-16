import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
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
import type { ObserverConfig, ObserveResult, SessionRef } from "./types.js";
import { createSessionMapper } from "./session-mapper.js";

interface ProcessedRecord {
  processedAt: string;
  episodeIds: string[];
  /** JSONL line watermark — number of lines already consumed (incremental processing). */
  processedLineCount?: number;
  lastDeltaAt?: string;
}

export function createObserver(config: ObserverConfig) {
  const { source, dataDir, llm, callbacks } = config;
  const gate = config.incrementalGate;
  const gateIdleMs = gate?.idleMs ?? 0; // 0 = idle check disabled
  const gateMinDeltaLines = gate?.minDeltaLines ?? 0; // 0 = size check disabled
  const stores = createFileSystemStores(dataDir);
  const mapper = createSessionMapper();

  const runtime = createExpLoop({
    ...stores,
    retriever: createExpRetriever({ store: stores.experienceStore }),
    extractor: createExpExtractor({ llm, maxCandidates: 3 }),
    guard: createExpGuard(),
    injector: createContextInjector({ format: "markdown" }),
    patternMiner: createPatternMiner({
      episodeStore: stores.episodeStore,
      patternStore: stores.patternStore,
    }),
    skillDistiller: createSkillDistiller({
      llm,
      episodeStore: stores.episodeStore,
      experienceStore: stores.experienceStore,
    }),
  });

  const processedPath = join(dataDir, "observer", "processed.json");

  async function loadProcessed(): Promise<Record<string, ProcessedRecord>> {
    try {
      const content = await readFile(processedPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  async function saveProcessed(
    records: Record<string, ProcessedRecord>,
  ): Promise<void> {
    await mkdir(dirname(processedPath), { recursive: true });
    await writeFile(processedPath, JSON.stringify(records, null, 2));
  }

  return {
    async observe(
      opts?: { after?: string; projectPath?: string; limit?: number },
    ): Promise<ObserveResult> {
      const refs = await source.listSessions(opts);
      const processed = await loadProcessed();

      const result: ObserveResult = {
        sessionsProcessed: 0,
        episodesCreated: 0,
        experiencesExtracted: 0,
        errors: [],
      };

      for (const ref of refs) {
        const rec = processed[ref.id];
        const supportsInc = source.supportsIncremental ?? false;
        const hasWatermark = rec?.processedLineCount !== undefined;

        // 1) Old record (processed, no watermark) → backwards-compatible boolean skip
        // 2) Watermarked + incremental → delta parse from processedLineCount
        // 3) New session → full parse from 0
        if (rec && !hasWatermark) continue;

        const isDelta = rec !== undefined && hasWatermark && supportsInc;
        const startLine = isDelta ? rec!.processedLineCount! : 0;

        // ── Incremental gate (delta sessions only) ──────────────────────
        // Avoid burning LLM calls on every few lines of an active conversation.
        // A delta is processed only when the file has been idle AND accumulated
        // enough new content. While deferred, the watermark stays put so the
        // accumulated delta grows until the gate opens.
        if (isDelta) {
          const now = Date.now();
          const idleMs = gateIdleMs > 0 ? now - (ref.mtimeMs ?? now) : Infinity;
          if (gateIdleMs > 0 && idleMs < gateIdleMs) {
            callbacks?.onSessionDeferred?.(
              ref,
              `file modified ${Math.round(idleMs / 1000)}s ago (< ${gateIdleMs / 1000}s idle)`,
            );
            continue;
          }
        }

        callbacks?.onSessionStart?.(ref);

        try {
          const session = await source.parseSession(ref, { startLine });

          // Delta with no new content → silently advance watermark, skip extraction
          if (isDelta && session.messages.length === 0) {
            processed[ref.id] = {
              ...rec!,
              processedLineCount: session.messagesEndLine ?? startLine,
              lastDeltaAt: new Date().toISOString(),
            };
            continue;
          }

          // Second half of the gate: require enough new lines since last processing.
          // Use consumed line count (messagesEndLine - startLine) to match "N lines".
          if (isDelta && gateMinDeltaLines > 0) {
            const deltaLines =
              (session.messagesEndLine ?? startLine) - startLine;
            if (deltaLines < gateMinDeltaLines) {
              callbacks?.onSessionDeferred?.(
                ref,
                `delta is ${deltaLines} line(s) (< ${gateMinDeltaLines} threshold)`,
              );
              // Don't advance the watermark — let the delta accumulate until the gate opens.
              continue;
            }
          }

          const episodes = isDelta
            ? mapper.mapDelta(session, {
                sessionId: ref.id,
                projectPath: ref.projectPath,
                deltaNumber: (rec?.episodeIds.length ?? 0) + 1,
                lineRange: [session.messagesStartLine ?? 0, session.messagesEndLine ?? 0],
              })
            : mapper.map(session);

          const episodeIds: string[] = rec ? [...rec.episodeIds] : [];
          for (const episode of episodes) {
            const afterRunResult = await runtime.afterRun({
              task: episode.task,
              status: episode.status,
              trace: episode.trace,
              result: episode.result,
              startedAt: episode.startedAt,
              endedAt: episode.endedAt,
              isDelta,
              priorEpisodeIds: isDelta ? rec!.episodeIds : undefined,
            });

            episodeIds.push(afterRunResult.episodeId);
            result.experiencesExtracted += afterRunResult.newExperiences.length;

            callbacks?.onSessionComplete?.(ref, afterRunResult);
          }

          result.episodesCreated += episodes.length;
          result.sessionsProcessed++;

          processed[ref.id] = {
            processedAt: new Date().toISOString(),
            episodeIds,
            processedLineCount: session.messagesEndLine,
            ...(isDelta ? { lastDeltaAt: new Date().toISOString() } : {}),
          };
        } catch (err) {
          const error =
            err instanceof Error ? err : new Error(String(err));
          result.errors.push({
            sessionId: ref.id,
            error: error.message,
          });
          callbacks?.onSessionError?.(ref, error);
        }
      }

      await saveProcessed(processed);
      return result;
    },

    async listProcessed(): Promise<Record<string, ProcessedRecord>> {
      return loadProcessed();
    },

    /** Delete a session's processed record so it gets fully re-parsed on next observe. */
    async resetProcessed(sessionId: string): Promise<boolean> {
      const records = await loadProcessed();
      if (!(sessionId in records)) return false;
      delete records[sessionId];
      await saveProcessed(records);
      return true;
    },
  };
}
