import type {
  ExperienceCandidate,
  Experience,
  ExpGuardConfig,
  ExpGuard,
  GuardResult,
} from "./types.js";

export function createExpGuard(config: ExpGuardConfig = {}): ExpGuard {
  const minConfidence = config.minConfidence ?? 0.5;
  const minApplyWhen = config.minApplyWhenCount ?? 1;
  const minRecommendationLen = config.minRecommendationLength ?? 20;

  return {
    async evaluate(
      candidate: ExperienceCandidate,
      existing: Experience[],
    ): Promise<GuardResult> {
      if (candidate.confidence < minConfidence) {
        return {
          decision: "reject",
          reason: `confidence ${candidate.confidence} < ${minConfidence}`,
        };
      }

      if (!candidate.applyWhen || candidate.applyWhen.length < minApplyWhen) {
        return { decision: "reject", reason: "missing or empty applyWhen" };
      }

      if (candidate.recommendation.length < minRecommendationLen) {
        return {
          decision: "reject",
          reason: `recommendation too short (${candidate.recommendation.length} < ${minRecommendationLen})`,
        };
      }

      const rec = candidate.recommendation
        .toLowerCase()
        .replace(/[‘’]/g, "'")
        .trimStart();
      if (
        (rec.startsWith("don't") ||
          rec.startsWith("do not") ||
          rec.startsWith("never") ||
          rec.startsWith("avoid")) &&
        !rec.includes("instead") &&
        !rec.includes("use ")
      ) {
        return {
          decision: "reject",
          reason:
            "recommendation is purely negative — must include a positive action",
        };
      }

      const duplicate = existing.find(
        (e) =>
          e.status === "active" &&
          (e.title === candidate.title ||
            titleSimilarity(e.title, candidate.title) > 0.8),
      );
      if (duplicate) {
        return {
          decision: "merge",
          reason: `similar to existing: ${duplicate.id}`,
          mergeTargetId: duplicate.id,
        };
      }

      return { decision: "accept", reason: "passed all checks" };
    },
  };
}

function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  return (2 * intersection.length) / (wordsA.size + wordsB.size);
}
