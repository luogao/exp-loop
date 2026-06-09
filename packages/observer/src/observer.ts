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
}

export function createObserver(config: ObserverConfig) {
  const { source, dataDir, llm, callbacks } = config;
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
        if (processed[ref.id]) continue;

        callbacks?.onSessionStart?.(ref);

        try {
          const session = await source.parseSession(ref);
          const episodes = mapper.map(session);

          const episodeIds: string[] = [];
          for (const episode of episodes) {
            const afterRunResult = await runtime.afterRun({
              task: episode.task,
              status: episode.status,
              trace: episode.trace,
              result: episode.result,
              startedAt: episode.startedAt,
              endedAt: episode.endedAt,
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
  };
}
