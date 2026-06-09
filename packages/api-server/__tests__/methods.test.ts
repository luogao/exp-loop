import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileSystemStores } from "@exp-loop/store-fs";
import { statsMethods } from "../src/methods/stats.js";
import { episodeMethods } from "../src/methods/episodes.js";
import { experienceMethods } from "../src/methods/experiences.js";
import { patternMethods } from "../src/methods/patterns.js";
import { skillMethods } from "../src/methods/skills.js";

const noop = () => {};

describe("method handlers", () => {
  let dataDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "api-methods-"));
    dataDir = join(tmp, ".exp-loop");
    await mkdir(dataDir, { recursive: true });
  });

  describe("stats.get", () => {
    it("returns zero counts for empty stores", async () => {
      const stores = createFileSystemStores(dataDir);
      const methods = statsMethods(stores);
      const result = await methods["stats.get"]({}, noop);

      expect(result).toEqual({
        episodes: { total: 0, success: 0, partial: 0, failure: 0 },
        experiences: { total: 0, active: 0, draft: 0, deprecated: 0 },
        patterns: { total: 0, candidateSkill: 0 },
        skills: { total: 0 },
      });
    });

    it("counts episodes by status", async () => {
      const stores = createFileSystemStores(dataDir);
      const episodesDir = join(dataDir, "episodes", "2026");
      await mkdir(episodesDir, { recursive: true });

      await writeFile(
        join(episodesDir, "ep_1.json"),
        JSON.stringify({
          id: "ep_1",
          task: { id: "t1", description: "test" },
          status: "success",
          trace: { steps: [] },
          startedAt: "2026-06-01T10:00:00Z",
          endedAt: "2026-06-01T10:05:00Z",
        }),
      );
      await writeFile(
        join(episodesDir, "ep_2.json"),
        JSON.stringify({
          id: "ep_2",
          task: { id: "t2", description: "test2" },
          status: "failure",
          trace: { steps: [] },
          startedAt: "2026-06-01T11:00:00Z",
          endedAt: "2026-06-01T11:05:00Z",
        }),
      );

      const methods = statsMethods(stores);
      const result = (await methods["stats.get"]({}, noop)) as any;

      expect(result.episodes.total).toBe(2);
      expect(result.episodes.success).toBe(1);
      expect(result.episodes.failure).toBe(1);
    });
  });

  describe("episodes", () => {
    it("lists and gets episodes", async () => {
      const stores = createFileSystemStores(dataDir);
      const episodesDir = join(dataDir, "episodes", "2026");
      await mkdir(episodesDir, { recursive: true });

      const episode = {
        id: "ep_test",
        task: { id: "t1", description: "test" },
        status: "success",
        trace: { steps: [] },
        startedAt: "2026-06-01T10:00:00Z",
        endedAt: "2026-06-01T10:05:00Z",
      };
      await writeFile(join(episodesDir, "ep_test.json"), JSON.stringify(episode));

      const methods = episodeMethods(stores);
      const list = (await methods["episodes.list"]({}, noop)) as any[];
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe("ep_test");

      const single = (await methods["episodes.get"]({ id: "ep_test" }, noop)) as any;
      expect(single.id).toBe("ep_test");

      const missing = await methods["episodes.get"]({ id: "nope" }, noop);
      expect(missing).toBeNull();
    });
  });

  describe("experiences", () => {
    it("returns empty list for empty store", async () => {
      const stores = createFileSystemStores(dataDir);
      const methods = experienceMethods(stores);
      const list = await methods["experiences.list"]({}, noop);
      expect(list).toEqual([]);
    });
  });

  describe("patterns", () => {
    it("returns empty list for empty store", async () => {
      const stores = createFileSystemStores(dataDir);
      const methods = patternMethods(stores);
      const list = await methods["patterns.list"]({}, noop);
      expect(list).toEqual([]);
    });
  });

  describe("skills", () => {
    it("returns empty list for empty registry", async () => {
      const stores = createFileSystemStores(dataDir);
      const methods = skillMethods(stores);
      const list = await methods["skills.listSummaries"]({}, noop);
      expect(list).toEqual([]);
    });

    it("returns null for missing skill", async () => {
      const stores = createFileSystemStores(dataDir);
      const methods = skillMethods(stores);
      const result = await methods["skills.load"]({ id: "nonexistent" }, noop);
      expect(result).toBeNull();
    });
  });
});
