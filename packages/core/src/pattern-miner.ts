import type {
  Episode,
  Pattern,
  PatternMinerConfig,
  PatternMiner,
} from "./types.js";
import { generateId } from "./utils.js";

export function createPatternMiner(
  config: PatternMinerConfig,
): PatternMiner {
  const minSupport = config.minSupport ?? 3;
  const minSuccessRate = config.minSuccessRate ?? 0.6;

  return {
    async mine(episode: Episode): Promise<Pattern[]> {
      const signature = computeSignature(episode);
      const existingPatterns = await config.patternStore.list();

      const matched = existingPatterns.find(
        (p) => p.signature === signature,
      );

      if (matched) {
        const episodeIds = [
          ...new Set([...matched.matchedEpisodeIds, episode.id]),
        ];
        const allEpisodes = await Promise.all(
          episodeIds.map((id) => config.episodeStore.get(id)),
        );
        const valid = allEpisodes.filter(Boolean) as Episode[];
        const successCount = valid.filter(
          (e) => e.status === "success",
        ).length;

        const updated: Partial<Pattern> = {
          matchedEpisodeIds: episodeIds,
          support: episodeIds.length,
          successRate: successCount / episodeIds.length,
          confidence: computePatternConfidence(valid),
          commonSteps: mergeSteps(matched.commonSteps, episode),
          commonTools: mergeTools(matched.commonTools, episode),
        };

        if (
          episodeIds.length >= minSupport &&
          updated.successRate! >= minSuccessRate &&
          matched.promotion === "none"
        ) {
          updated.promotion = "candidate_skill";
        }

        await config.patternStore.update(matched.id, updated);
        return [{ ...matched, ...updated }];
      }

      const newPattern: Pattern = {
        id: generateId("pat"),
        domain: episode.task.domain,
        taskType: episode.task.taskType,
        signature,
        matchedEpisodeIds: [episode.id],
        commonSteps: episode.trace.steps.map((s) => s.action),
        commonTools: episode.trace.toolCalls?.map((t) => t.name),
        recurringFailures: episode.trace.errors?.map((e) => e.message),
        successRate: episode.status === "success" ? 1 : 0,
        support: 1,
        confidence: 0.3,
        promotion: "none",
      };
      await config.patternStore.save(newPattern);
      return [newPattern];
    },
  };
}

function computeSignature(episode: Episode): string {
  const parts = [
    episode.task.domain ?? "any",
    episode.task.taskType ?? "any",
  ];
  if (episode.task.tags?.length) {
    parts.push(...[...episode.task.tags].sort());
  }
  return parts.join("::");
}

function computePatternConfidence(episodes: Episode[]): number {
  if (episodes.length === 0) return 0;
  const successRate =
    episodes.filter((e) => e.status === "success").length / episodes.length;
  const volumeFactor = Math.min(episodes.length / 5, 1);
  return successRate * 0.7 + volumeFactor * 0.3;
}

function mergeSteps(existing: string[], episode: Episode): string[] {
  const newSteps = episode.trace.steps.map((s) => s.action);
  const merged = new Set([...existing, ...newSteps]);
  return [...merged];
}

function mergeTools(
  existing: string[] | undefined,
  episode: Episode,
): string[] | undefined {
  const newTools = episode.trace.toolCalls?.map((t) => t.name);
  if (!existing && !newTools) return undefined;
  const merged = new Set([...(existing ?? []), ...(newTools ?? [])]);
  return [...merged];
}
