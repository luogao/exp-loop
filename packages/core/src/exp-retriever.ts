import type {
  Experience,
  Task,
  RetrieverConfig,
  ExpRetriever,
  RetrieveInput,
} from "./types.js";

export function createExpRetriever(config: RetrieverConfig): ExpRetriever {
  return {
    async retrieve(input: RetrieveInput): Promise<Experience[]> {
      const topK = input.topK ?? config.topK ?? 5;
      const all = await config.store.list({ status: "active" });

      const scored = all.map((exp) => ({
        exp,
        score: computeRelevance(exp, input.task),
      }));

      scored.sort((a, b) => b.score - a.score);
      return scored
        .filter((s) => s.score > 0)
        .slice(0, topK)
        .map((s) => s.exp);
    },
  };
}

function computeRelevance(exp: Experience, task: Task): number {
  let score = 0;

  if (exp.domain && exp.domain === task.domain) score += 3;
  if (exp.taskType && exp.taskType === task.taskType) score += 2;

  const taskText =
    `${task.description} ${(task.tags ?? []).join(" ")}`.toLowerCase();
  for (const trigger of exp.triggers) {
    if (taskText.includes(trigger.toLowerCase())) score += 2;
  }

  if (task.tags) {
    const tagSet = new Set(task.tags.map((t) => t.toLowerCase()));
    for (const trigger of exp.triggers) {
      if (tagSet.has(trigger.toLowerCase())) score += 1;
    }
  }

  return score;
}
