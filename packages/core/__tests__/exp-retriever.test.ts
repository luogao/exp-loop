import { describe, it, expect } from "vitest";
import { createExpRetriever } from "../src/exp-retriever.js";
import { makeExperience, makeTask } from "./fixtures.js";
import type { ExperienceStore, ExpListQuery, Experience, ExperienceUsage } from "../src/types.js";

function makeMemoryStore(experiences: Experience[]): ExperienceStore {
  return {
    async save() {},
    async get(id) {
      return experiences.find((e) => e.id === id) ?? null;
    },
    async list(query?: ExpListQuery) {
      return experiences.filter((e) => {
        if (query?.status && e.status !== query.status) return false;
        if (query?.domain && e.domain !== query.domain) return false;
        return true;
      });
    },
    async update() {},
    async recordUsage(_usage: ExperienceUsage) {},
  };
}

describe("ExpRetriever", () => {
  it("should retrieve experiences matching domain and triggers", async () => {
    const experiences = [
      makeExperience({ id: "exp_1", domain: "frontend", triggers: ["css", "overflow"] }),
      makeExperience({ id: "exp_2", domain: "backend", taskType: "api", triggers: ["sql"] }),
      makeExperience({ id: "exp_3", domain: "frontend", triggers: ["react", "state"] }),
    ];

    const retriever = createExpRetriever({
      store: makeMemoryStore(experiences),
      topK: 5,
    });

    const results = await retriever.retrieve({
      task: makeTask({ description: "Fix CSS overflow in sidebar", domain: "frontend" }),
    });

    expect(results[0].id).toBe("exp_1");
    expect(results.find((r) => r.id === "exp_2")).toBeUndefined();
  });

  it("should respect topK", async () => {
    const experiences = Array.from({ length: 10 }, (_, i) =>
      makeExperience({
        id: `exp_${i}`,
        domain: "frontend",
        triggers: ["css"],
      }),
    );

    const retriever = createExpRetriever({
      store: makeMemoryStore(experiences),
      topK: 3,
    });

    const results = await retriever.retrieve({ task: makeTask() });
    expect(results).toHaveLength(3);
  });

  it("should return empty array when no matches", async () => {
    const retriever = createExpRetriever({
      store: makeMemoryStore([
        makeExperience({ domain: "backend", taskType: "api", triggers: ["sql"] }),
      ]),
      topK: 5,
    });

    const results = await retriever.retrieve({
      task: makeTask({
        description: "unrelated task",
        domain: "data",
        tags: [],
      }),
    });

    expect(results).toHaveLength(0);
  });
});
