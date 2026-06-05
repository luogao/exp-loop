import type {
  Episode,
  ExperienceCandidate,
  ExtractorConfig,
  ExpExtractor,
} from "./types.js";

export function createExpExtractor(config: ExtractorConfig): ExpExtractor {
  return {
    async extract(episode: Episode): Promise<ExperienceCandidate[]> {
      const prompt = buildExtractionPrompt(episode);
      const raw = await config.llm(prompt);
      const candidates = parseExtractorResponse(raw);
      return candidates.slice(0, config.maxCandidates ?? 3);
    },
  };
}

function buildExtractionPrompt(episode: Episode): string {
  return `You are an experience extraction system. Analyze this task episode and extract reusable, actionable recommendations.

## Task
${JSON.stringify(episode.task, null, 2)}

## Status: ${episode.status}

## Execution Trace
${JSON.stringify(episode.trace, null, 2)}

## Result
${JSON.stringify(episode.result, null, 2)}

## Instructions
Extract 1-3 reusable experiences. Each experience MUST be framed as a **positive recommendation** — tell the agent what TO DO, not what to avoid.

Each experience must have:
- title: concise name describing the recommended practice
- problem: what situation or challenge triggers this
- recommendation: the correct approach (MUST be a positive, actionable instruction — "Use X", "Do Y", "Apply Z")
- triggers: keywords array that identify when this applies
- applyWhen: specific conditions for applicability
- avoid: (optional) what NOT to do, as supplementary context only
- confidence: 0-1

### Framing rules
- The "recommendation" field is the core of the experience. It must be a direct, positive instruction.
- BAD: "Don't use get_json_object on MAP columns"
- GOOD: "Use props['key'] map-access syntax for MAP-typed columns in app_xlog tables"
- The "avoid" field is optional and supplementary. Only include it when the wrong approach is non-obvious and naming it adds clarity.

Focus on:
- Correct tool usage patterns and API idioms
- Effective workarounds for known constraints
- Corrections the agent made mid-task (extract the corrected approach, not the mistake)
- Verification steps that proved valuable

Do NOT extract:
- Temporary task state
- One-off logs or URLs
- Generic advice ("be careful", "test thoroughly")
- Purely negative lessons with no positive recommendation

Respond with a JSON array of ExperienceCandidate objects.`;
}

function parseExtractorResponse(raw: string): ExperienceCandidate[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
}
