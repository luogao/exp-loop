import type {
  Episode,
  ExperienceCandidate,
  ExistingExperienceSummary,
  ExtractContext,
  ExtractorConfig,
  ExpExtractor,
} from "./types.js";

export function createExpExtractor(config: ExtractorConfig): ExpExtractor {
  return {
    async extract(
      episode: Episode,
      ctx?: ExtractContext,
    ): Promise<ExperienceCandidate[]> {
      const prompt =
        ctx?.isDelta && ctx.existingExperienceTitles?.length
          ? buildDeltaExtractionPrompt(episode, ctx.existingExperienceTitles)
          : buildExtractionPrompt(episode);
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

Do NOT include a "scope" field — scope is determined automatically.

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

function buildDeltaExtractionPrompt(
  episode: Episode,
  titles: Array<{ id: string; title: string }>,
): string {
  // Compact one-line-per-experience listing — cheap on tokens, but lets the LLM
  // do SEMANTIC duplicate detection (which lexical similarity cannot: same lesson
  // gets paraphrased with totally different words each time).
  const titleList = titles.map((t) => `- ${t.id}: ${t.title}`).join("\n");

  return `You are an experience extraction system. This episode is an INCREMENTAL DELTA — newly appended activity. Below is the FULL list of experiences already learned in this scope. Your most important job is to AVOID DUPLICATES: if a candidate expresses the same underlying lesson as an existing experience (even if worded completely differently), you MUST route it as merge or update, NOT new.

## New Delta Content
### Task
${JSON.stringify(episode.task, null, 2)}

### Status: ${episode.status}

### Execution Trace
${JSON.stringify(episode.trace, null, 2)}

### Result
${JSON.stringify(episode.result, null, 2)}

## Existing Experiences Already in This Scope (id: title)
${titleList}

## Instructions
Extract 0-2 candidates from the delta. For EACH candidate include a \`routingHint\`:
- action: "merge" — the SAME lesson as an existing experience (even if worded differently). Set targetExperienceId to that existing id. Prefer this whenever the candidate overlaps an existing one at all.
- action: "update" — a genuine correction/refinement of an existing experience's recommendation. Set targetExperienceId. Write the FULL new recommendation (it replaces the old).
- action: "new" — ONLY use this when the candidate is about a genuinely distinct topic not covered by ANY existing experience. Be conservative — when in doubt, merge.

Default to "merge" over "new". Two experiences about the same practice (e.g. "deduplicate within batch" and "union evidence on merge") are the SAME lesson — merge them, don't create both.

Each candidate needs: title, problem, recommendation (positive, actionable — "Use X", "Do Y"), triggers, applyWhen, confidence, avoid (optional).

If the delta contains nothing worth extracting (chitchat, no reusable signal), respond with \`[]\`.

Respond with a JSON array of ExperienceCandidate objects, each with a routingHint.`;
}
