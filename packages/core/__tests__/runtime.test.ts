import { describe, it, expect } from "vitest";
import { createExpLoop } from "../src/runtime.js";
import { createExpGuard } from "../src/exp-guard.js";
import type {
  Episode,
  Experience,
  ExperienceCandidate,
  ExperienceStore,
  EpisodeStore,
  ExpRetriever,
  ContextInjector,
} from "../src/types.js";
import { makeEpisode, makeCandidate, makeExperience } from "./fixtures.js";

// ── In-memory store mocks ────────────────────────────────────────────

function makeMemoryExperienceStore(initial: Experience[] = []): ExperienceStore & {
  data: Experience[];
} {
  const data: Experience[] = [...initial];
  return {
    data,
    async save(exp) {
      data.push(exp);
    },
    async get(id) {
      return data.find((e) => e.id === id) ?? null;
    },
    async list(query) {
      return data.filter(
        (e) =>
          (!query?.scope || e.scope === query.scope) &&
          (!query?.status || e.status === query.status),
      );
    },
    async update(id, patch) {
      const i = data.findIndex((e) => e.id === id);
      if (i >= 0) data[i] = { ...data[i], ...patch };
    },
    async recordUsage() {},
  };
}

function makeMemoryEpisodeStore(): EpisodeStore {
  return {
    async save() {},
    async get() {
      return null;
    },
    async list() {
      return [];
    },
  };
}

const noopRetriever: ExpRetriever = { async retrieve() {
  return [];
} };
const noopInjector: ContextInjector = { render() {
  return "";
} };

function makeRuntime(opts: {
  experiences?: Experience[];
  extract: (episode: Episode) => Promise<ExperienceCandidate[]>;
}) {
  const experienceStore = makeMemoryExperienceStore(opts.experiences ?? []);
  const episodeStore = makeMemoryEpisodeStore();
  const extractor = { extract: opts.extract };
  const runtime = createExpLoop({
    episodeStore,
    experienceStore,
    retriever: noopRetriever,
    extractor,
    guard: createExpGuard(),
    injector: noopInjector,
  });
  return { runtime, experienceStore };
}

const baseAfterRun = {
  status: "success" as const,
  trace: makeEpisode().trace,
  result: makeEpisode().result,
  startedAt: "2026-06-01T10:00:00Z",
  endedAt: "2026-06-01T10:30:00Z",
};

describe("createExpLoop afterRun — delta dedup routing", () => {
  it("deduplicates similar candidates WITHIN a single batch (candidate-vs-candidate)", async () => {
    // Three candidates that are near-duplicates of each other.
    const similar: ExperienceCandidate[] = [
      makeCandidate({ title: "Use overflow-hidden for sidebar containers" }),
      makeCandidate({ title: "Apply overflow-hidden to sidebar container elements" }),
      makeCandidate({ title: "Prevent layout shift with overflow-hidden on sidebars" }),
    ];

    const { runtime, experienceStore } = makeRuntime({
      extract: async () => similar,
    });

    const result = await runtime.afterRun({
      task: { ...makeEpisode().task, metadata: { projectPath: "/p" } },
      ...baseAfterRun,
      isDelta: true,
    });

    // All three near-duplicate candidates collapse into a single stored experience.
    expect(experienceStore.data.filter((e) => e.status === "active")).toHaveLength(1);
  });

  it("merges a candidate into a SIMILAR pre-existing experience instead of creating new", async () => {
    const existing = makeExperience({
      id: "exp_existing_1",
      title: "Use overflow-hidden for sidebar containers",
      scope: "project",
      sourceEpisodeIds: ["ep_old"],
    });

    const { runtime, experienceStore } = makeRuntime({
      experiences: [existing],
      extract: async () => [
        makeCandidate({
          title: "Prevent sidebar layout shift with overflow-hidden containers",
        }),
      ],
    });

    const result = await runtime.afterRun({
      task: { ...makeEpisode().task, metadata: { projectPath: "/p" } },
      ...baseAfterRun,
      isDelta: true,
    });

    expect(result.newExperiences).toHaveLength(0);
    expect(result.updatedExperiences.map((e) => e.id)).toContain("exp_existing_1");
    // No second experience was created.
    expect(experienceStore.data).toHaveLength(1);
    // The existing one gained the new episode id alongside the old one.
    const updated = experienceStore.data[0];
    expect(updated.sourceEpisodeIds).toContain("ep_old");
    expect(updated.sourceEpisodeIds.length).toBeGreaterThanOrEqual(2);
  });

  it("creates a new experience when the candidate is genuinely novel", async () => {
    const existing = makeExperience({
      id: "exp_existing_1",
      title: "Use overflow-hidden for sidebar containers",
      scope: "project",
    });

    const { runtime, experienceStore } = makeRuntime({
      experiences: [existing],
      extract: async () => [
        makeCandidate({
          title: "Configure webpack module federation for micro-frontends",
          triggers: ["webpack", "federation", "microfrontend"],
          problem: "Micro-frontends need shared dependency loading",
          recommendation:
            "Configure webpack ModuleFederationPlugin with shared singleton dependencies to load micro-frontends at runtime",
          applyWhen: ["Setting up micro-frontend architecture"],
        }),
      ],
    });

    const result = await runtime.afterRun({
      task: { ...makeEpisode().task, metadata: { projectPath: "/p" } },
      ...baseAfterRun,
      isDelta: true,
    });

    expect(result.newExperiences).toHaveLength(1);
    expect(experienceStore.data).toHaveLength(2);
  });

  it("honors an LLM merge hint even when lexical similarity is zero (semantic dedup)", async () => {
    // Existing experience and a candidate about the SAME lesson but with totally
    // different wording — lexical similarity would be ~0. The LLM (mocked here
    // via routingHint) correctly identifies them as duplicates.
    const existing = makeExperience({
      id: "exp_union_evidence",
      title: "Union all evidence and metadata when merging duplicate experiences",
      scope: "project",
      sourceEpisodeIds: ["ep_old"],
    });

    const { runtime, experienceStore } = makeRuntime({
      experiences: [existing],
      extract: async () => [
        makeCandidate({
          title: "Accumulate evidence onto the surviving experience during dedup merges",
          triggers: ["dedup", "merge", "evidence"],
          problem: "Merging loses evidence",
          recommendation:
            "When merging duplicate experiences, union their evidence and source episode ids onto the kept record",
          applyWhen: ["Deduplicating experiences"],
          routingHint: { action: "merge", targetExperienceId: "exp_union_evidence" },
        }),
      ],
    });

    const result = await runtime.afterRun({
      task: { ...makeEpisode().task, metadata: { projectPath: "/p" } },
      ...baseAfterRun,
      isDelta: true,
    });

    // Hint trusted → merged, no new experience created.
    expect(result.newExperiences).toHaveLength(0);
    expect(experienceStore.data).toHaveLength(1);
    expect(result.updatedExperiences.map((e) => e.id)).toContain("exp_union_evidence");
  });
});
