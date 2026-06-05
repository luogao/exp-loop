import { describe, it, expect } from "vitest";
import { createPatternMiner } from "../src/pattern-miner.js";
import { makeEpisode } from "./fixtures.js";
import type { Episode, EpisodeStore, Pattern, PatternStore, EpisodeQuery } from "../src/types.js";

function makeMemoryEpisodeStore(episodes: Episode[]): EpisodeStore {
  return {
    async save(ep) { episodes.push(ep); },
    async get(id) { return episodes.find((e) => e.id === id) ?? null; },
    async list(_query?: EpisodeQuery) { return episodes; },
  };
}

function makeMemoryPatternStore(): PatternStore & { patterns: Pattern[] } {
  const patterns: Pattern[] = [];
  return {
    patterns,
    async save(p) { patterns.push(p); },
    async get(id) { return patterns.find((p) => p.id === id) ?? null; },
    async list() { return [...patterns]; },
    async update(id, patch) {
      const idx = patterns.findIndex((p) => p.id === id);
      if (idx >= 0) patterns[idx] = { ...patterns[idx], ...patch };
    },
  };
}

describe("PatternMiner", () => {
  it("should create a new pattern for a novel episode", async () => {
    const episodes = [makeEpisode()];
    const patternStore = makeMemoryPatternStore();

    const miner = createPatternMiner({
      episodeStore: makeMemoryEpisodeStore(episodes),
      patternStore,
    });

    const result = await miner.mine(makeEpisode());
    expect(result).toHaveLength(1);
    expect(result[0].support).toBe(1);
    expect(result[0].promotion).toBe("none");
    expect(patternStore.patterns).toHaveLength(1);
  });

  it("should accumulate episodes into existing pattern", async () => {
    const ep1 = makeEpisode({ id: "ep_1" });
    const ep2 = makeEpisode({ id: "ep_2" });
    const episodes = [ep1, ep2];
    const patternStore = makeMemoryPatternStore();

    const miner = createPatternMiner({
      episodeStore: makeMemoryEpisodeStore(episodes),
      patternStore,
    });

    await miner.mine(ep1);
    const result = await miner.mine(ep2);

    expect(result).toHaveLength(1);
    expect(result[0].support).toBe(2);
    expect(result[0].matchedEpisodeIds).toContain("ep_1");
    expect(result[0].matchedEpisodeIds).toContain("ep_2");
  });

  it("should promote pattern to candidate_skill at minSupport", async () => {
    const episodes = Array.from({ length: 3 }, (_, i) =>
      makeEpisode({ id: `ep_${i}`, status: "success" }),
    );
    const patternStore = makeMemoryPatternStore();

    const miner = createPatternMiner({
      episodeStore: makeMemoryEpisodeStore(episodes),
      patternStore,
      minSupport: 3,
    });

    await miner.mine(episodes[0]);
    await miner.mine(episodes[1]);
    const result = await miner.mine(episodes[2]);

    expect(result[0].support).toBe(3);
    expect(result[0].promotion).toBe("candidate_skill");
  });

  it("should not promote when success rate is too low", async () => {
    const episodes = [
      makeEpisode({ id: "ep_0", status: "success" }),
      makeEpisode({ id: "ep_1", status: "failure" }),
      makeEpisode({ id: "ep_2", status: "failure" }),
    ];
    const patternStore = makeMemoryPatternStore();

    const miner = createPatternMiner({
      episodeStore: makeMemoryEpisodeStore(episodes),
      patternStore,
      minSupport: 3,
      minSuccessRate: 0.6,
    });

    for (const ep of episodes) await miner.mine(ep);

    expect(patternStore.patterns[0].promotion).toBe("none");
  });
});
