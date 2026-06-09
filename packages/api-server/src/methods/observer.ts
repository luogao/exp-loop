import { ClaudeCodeIngestSource, createObserver } from "@exp-loop/observer";
import type { ObserveResult } from "@exp-loop/observer";
import type { MethodHandler, Emitter } from "../server.js";
import type { AppConfig } from "../config.js";
import { createLlm } from "../llm.js";
import { createLogger } from "../logger.js";

export function observerMethods(getConfig: () => AppConfig): Record<string, MethodHandler> {
  return {
    "observer.observe": async (params, emit) => {
      const config = getConfig();
      const logger = createLogger(config.dataDir, emit);

      await logger.info("开始观察会话");

      const llm = await createLlm(config, (status, detail) => {
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

      const source = new ClaudeCodeIngestSource(config.claudeProjectsDir);

      const observer = createObserver({
        source,
        dataDir: config.dataDir,
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
      const selectedProjects = config.selectedProjects ?? [];

      if (explicitProject) {
        const result = await observer.observe({
          projectPath: explicitProject,
          after: params.after as string | undefined,
          limit: params.limit as number | undefined,
        });
        await logger.info("观察完成", `${result.sessionsProcessed} 个会话, ${result.experiencesExtracted} 条经验`);
        return result;
      }

      if (selectedProjects.length > 0) {
        await logger.info(`按项目学习: ${selectedProjects.length} 个项目`);
        const combined: ObserveResult = {
          sessionsProcessed: 0,
          episodesCreated: 0,
          experiencesExtracted: 0,
          errors: [],
        };
        for (const project of selectedProjects) {
          await logger.info(`开始处理项目: ${project}`);
          const result = await observer.observe({
            projectPath: project,
            after: params.after as string | undefined,
            limit: params.limit as number | undefined,
          });
          combined.sessionsProcessed += result.sessionsProcessed;
          combined.episodesCreated += result.episodesCreated;
          combined.experiencesExtracted += result.experiencesExtracted;
          combined.errors.push(...result.errors);
        }
        await logger.info("观察完成", `${combined.sessionsProcessed} 个会话, ${combined.experiencesExtracted} 条经验`);
        return combined;
      }

      const result = await observer.observe({
        after: params.after as string | undefined,
        limit: params.limit as number | undefined,
      });
      await logger.info("观察完成", `${result.sessionsProcessed} 个会话, ${result.experiencesExtracted} 条经验`);
      return result;
    },

    "observer.listProcessed": async () => {
      const config = getConfig();
      const llm = await createLlm(config);
      const source = new ClaudeCodeIngestSource(config.claudeProjectsDir);
      const observer = createObserver({ source, dataDir: config.dataDir, llm });
      return observer.listProcessed();
    },
  };
}
