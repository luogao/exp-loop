import { describe, it, expect } from "vitest";
import { createExpExtractor } from "../src/exp-extractor.js";
import { makeEpisode } from "./fixtures.js";

describe("ExpExtractor", () => {
  it("should extract candidates from episode via LLM", async () => {
    const mockLlm = async (_prompt: string) =>
      JSON.stringify([
        {
          title: "Use overflow-hidden for sidebar",
          problem: "Sidebar overflows on resize",
          recommendation:
            "Use overflow: hidden instead of scroll for sidebar containers",
          triggers: ["css", "overflow"],
          applyWhen: ["Working with sidebar components"],
          confidence: 0.8,
        },
      ]);

    const extractor = createExpExtractor({ llm: mockLlm });
    const candidates = await extractor.extract(makeEpisode());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toBe("Use overflow-hidden for sidebar");
    expect(candidates[0].recommendation).toContain("overflow: hidden");
  });

  it("should respect maxCandidates", async () => {
    const mockLlm = async () =>
      JSON.stringify([
        { title: "a", problem: "p", recommendation: "r", triggers: [], applyWhen: [], confidence: 0.8 },
        { title: "b", problem: "p", recommendation: "r", triggers: [], applyWhen: [], confidence: 0.7 },
        { title: "c", problem: "p", recommendation: "r", triggers: [], applyWhen: [], confidence: 0.6 },
      ]);

    const extractor = createExpExtractor({ llm: mockLlm, maxCandidates: 2 });
    const candidates = await extractor.extract(makeEpisode());

    expect(candidates).toHaveLength(2);
  });

  it("should handle malformed LLM response gracefully", async () => {
    const mockLlm = async () => "This is not JSON at all";

    const extractor = createExpExtractor({ llm: mockLlm });
    const candidates = await extractor.extract(makeEpisode());

    expect(candidates).toHaveLength(0);
  });
});
