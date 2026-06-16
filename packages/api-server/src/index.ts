import { createFileSystemStores } from "@exp-loop/store-fs";
import { createApiServer } from "./server.js";
import type { ApiServer, MethodHandler } from "./server.js";
import { loadConfig, type AppConfig } from "./config.js";
import { episodeMethods } from "./methods/episodes.js";
import { experienceMethods } from "./methods/experiences.js";
import { patternMethods } from "./methods/patterns.js";
import { skillMethods } from "./methods/skills.js";
import { statsMethods } from "./methods/stats.js";
import { observerMethods } from "./methods/observer.js";
import { syncerMethods } from "./methods/syncer.js";
import { configMethods } from "./methods/config.js";
import { sourceMethods } from "./methods/sources.js";
import { schedulerMethods } from "./methods/scheduler.js";
import { createLlm } from "./llm.js";
import { createLogger } from "./logger.js";
import { ClaudeCodeIngestSource, createObserver } from "@exp-loop/observer";
import { createClaudeMdSyncer } from "@exp-loop/syncer";

export async function buildServer(): Promise<ApiServer> {
  let config = await loadConfig();
  let stores = createFileSystemStores(config.dataDir);

  const server = createApiServer();

  function getConfig(): AppConfig {
    return config;
  }

  function onConfigChange(newConfig: AppConfig): void {
    config = newConfig;
    stores = createFileSystemStores(newConfig.dataDir);
    reregisterStoreMethods();
  }

  function reregisterStoreMethods(): void {
    const allMethods: Record<string, MethodHandler> = {
      ...episodeMethods(stores),
      ...experienceMethods(stores),
      ...patternMethods(stores),
      ...skillMethods(stores),
      ...statsMethods(stores),
      ...syncerMethods(stores, config.dataDir),
    };
    for (const [name, handler] of Object.entries(allMethods)) {
      server.register(name, handler);
    }
  }

  reregisterStoreMethods();

  for (const [name, handler] of Object.entries(observerMethods(getConfig))) {
    server.register(name, handler);
  }

  for (const [name, handler] of Object.entries(configMethods(onConfigChange))) {
    server.register(name, handler);
  }

  for (const [name, handler] of Object.entries(sourceMethods())) {
    server.register(name, handler);
  }

  // Scheduler methods (background auto-collection)
  for (const [name, handler] of Object.entries(schedulerMethods(getConfig))) {
    server.register(name, handler);
  }

  // learn = observe + sync combined
  server.register("learn", async (params, emit) => {
    const cfg = getConfig();
    const logger = createLogger(cfg.dataDir, emit);

    await logger.info("开始学习");

    const llm = await createLlm(cfg, (status, detail) => {
      if (status === "start") {
        emit("llm.status", { status: "calling", detail });
        logger.llm(`LLM 调用开始: ${detail}`);
      } else if (status === "done") {
        emit("llm.status", { status: "idle", detail });
        logger.llm(`LLM 调用完成: ${detail}`);
      } else {
        emit("llm.status", { status: "error", detail });
        logger.error(`LLM 调用失败: ${detail}`);
      }
    });
    const source = new ClaudeCodeIngestSource(cfg.claudeProjectsDir);
    const observer = createObserver({
      source,
      dataDir: cfg.dataDir,
      llm,
      callbacks: {
        onSessionStart(ref) {
          emit("observer.sessionStart", { ref });
          logger.info(`处理会话: ${ref.title || ref.id}`);
        },
        onSessionComplete(ref, result) {
          emit("observer.sessionComplete", {
            ref,
            result: {
              episodeId: result.episodeId,
              newExperiences: result.newExperiences.length,
              updatedPatterns: result.updatedPatterns.length,
              skillProposals: result.skillProposals.length,
            },
          });
          logger.info(
            `会话完成: ${ref.title || ref.id}`,
            `${result.newExperiences.length} 经验, ${result.updatedPatterns.length} 模式`,
          );
        },
        onSessionError(ref, error) {
          emit("observer.sessionError", { ref, error: error.message });
          logger.error(`会话失败: ${ref.title || ref.id}`, error.message);
        },
      },
    });

    const explicitProject = params.projectPath as string | undefined;
    const selectedProjects = cfg.selectedProjects ?? [];

    let observeResult;
    if (explicitProject) {
      await logger.info(`学习指定项目: ${explicitProject}`);
      observeResult = await observer.observe({ projectPath: explicitProject, after: params.after as string | undefined });
    } else if (selectedProjects.length > 0) {
      await logger.info(`按项目学习: ${selectedProjects.length} 个项目`);
      observeResult = { sessionsProcessed: 0, episodesCreated: 0, experiencesExtracted: 0, errors: [] as { sessionId: string; error: string }[] };
      for (const project of selectedProjects) {
        await logger.info(`开始处理项目: ${project}`);
        const r = await observer.observe({ projectPath: project, after: params.after as string | undefined });
        observeResult.sessionsProcessed += r.sessionsProcessed;
        observeResult.episodesCreated += r.episodesCreated;
        observeResult.experiencesExtracted += r.experiencesExtracted;
        observeResult.errors.push(...r.errors);
      }
    } else {
      observeResult = await observer.observe({ after: params.after as string | undefined });
    }

    await logger.info("学习完成", `${observeResult.sessionsProcessed} 个会话, ${observeResult.experiencesExtracted} 条经验`);

    const currentStores = createFileSystemStores(cfg.dataDir);
    const syncer = createClaudeMdSyncer({}, currentStores);
    const syncResults = await syncer.syncAll(
      explicitProject,
    );

    return { observe: observeResult, sync: syncResults };
  });

  return server;
}

export { createApiServer } from "./server.js";
export type {
  ApiServer,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  MethodHandler,
  Emitter,
} from "./server.js";
export type { AppConfig, LlmKeySource, DetectedSource, DetectedCredential, DetectedProject } from "./config.js";
