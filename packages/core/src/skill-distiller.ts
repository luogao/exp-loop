import type {
  Episode,
  Experience,
  Pattern,
  SkillProposal,
  SkillDistillerConfig,
  SkillDistiller,
} from "./types.js";
import { generateId } from "./utils.js";

export function createSkillDistiller(
  config: SkillDistillerConfig,
): SkillDistiller {
  return {
    async distill(pattern: Pattern): Promise<SkillProposal | null> {
      const episodes = (
        await Promise.all(
          pattern.matchedEpisodeIds.map((id) => config.episodeStore.get(id)),
        )
      ).filter(Boolean) as Episode[];

      const allExps = await config.experienceStore.list({
        domain: pattern.domain,
        taskType: pattern.taskType,
      });
      const relatedExps = allExps.filter((exp) =>
        exp.sourceEpisodeIds.some((id) =>
          pattern.matchedEpisodeIds.includes(id),
        ),
      );

      const prompt = buildDistillPrompt(pattern, episodes, relatedExps);
      const raw = await config.llm(prompt);
      const parsed = parseSkillResponse(raw);
      if (!parsed) return null;

      return {
        id: generateId("sp"),
        title: parsed.name,
        reason: `Pattern ${pattern.id} reached ${pattern.support} episodes with ${(pattern.successRate * 100).toFixed(0)}% success`,
        sourcePatternId: pattern.id,
        sourceExperienceIds: relatedExps.map((e) => e.id),
        proposedSkill: {
          name: parsed.name,
          description: parsed.description,
          domain: pattern.domain,
          taskType: pattern.taskType,
          scope: pattern.domain ? "domain" : "global",
          triggers: parsed.triggers,
          version: "0.1.0",
          status: "draft",
          sourcePatternIds: [pattern.id],
          sourceExperienceIds: relatedExps.map((e) => e.id),
          content: parsed.content,
        },
        confidence: pattern.confidence,
        status: "pending_review",
      };
    },
  };
}

function buildDistillPrompt(
  pattern: Pattern,
  episodes: Episode[],
  experiences: Experience[],
): string {
  return `You are a skill distillation system. Based on repeated task patterns and accumulated experiences, generate a reusable skill document.

## Pattern
Signature: ${pattern.signature}
Episodes: ${pattern.support}
Success rate: ${(pattern.successRate * 100).toFixed(0)}%
Common steps: ${pattern.commonSteps.join(" → ")}
Common tools: ${pattern.commonTools?.join(", ") ?? "none"}
Recurring failures: ${pattern.recurringFailures?.join(", ") ?? "none"}

## Sample Episodes (${episodes.length})
${episodes
  .slice(0, 3)
  .map(
    (ep) =>
      `- [${ep.status}] ${ep.task.description} (${ep.trace.steps.length} steps)`,
  )
  .join("\n")}

## Related Experiences (${experiences.length})
${experiences.map((exp) => `- ${exp.title}: ${exp.recommendation}`).join("\n")}

## Instructions
Generate a skill with:
- name: short kebab-case name
- description: one-line description
- triggers: keywords array
- content: full Markdown body with sections:
  - When To Use
  - Workflow (numbered steps)
  - Common Pitfalls (framed positively — what to do, not what to avoid)
  - Verification

Respond with JSON: { name, description, triggers, content }`;
}

function parseSkillResponse(
  raw: string,
): {
  name: string;
  description: string;
  triggers: string[];
  content: string;
} | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}
