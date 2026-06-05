import type {
  Task,
  Episode,
  Experience,
  ExperienceCandidate,
  ExecutionTrace,
} from "../src/types.js";

export function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: "task_test_001",
    description: "Fix CSS overflow bug in sidebar component",
    domain: "frontend",
    taskType: "bugfix",
    tags: ["css", "layout"],
    ...overrides,
  };
}

export function makeTrace(overrides?: Partial<ExecutionTrace>): ExecutionTrace {
  return {
    steps: [
      { index: 0, action: "inspect component tree" },
      { index: 1, action: "identify overflow in sidebar" },
      { index: 2, action: "apply overflow-hidden fix" },
      { index: 3, action: "run tests" },
      { index: 4, action: "browser verification" },
    ],
    toolCalls: [
      { name: "read_file", args: { path: "sidebar.tsx" } },
      { name: "edit_file", args: { path: "sidebar.tsx" } },
    ],
    corrections: [
      {
        from: "overflow: scroll",
        to: "overflow: hidden",
        reason: "scroll causes layout shift on resize",
      },
    ],
    ...overrides,
  };
}

export function makeEpisode(overrides?: Partial<Episode>): Episode {
  return {
    id: "ep_test_001",
    task: makeTask(),
    status: "success",
    trace: makeTrace(),
    result: "Fixed sidebar overflow, verified in Chrome and Firefox",
    startedAt: "2026-06-01T10:00:00Z",
    endedAt: "2026-06-01T10:30:00Z",
    ...overrides,
  };
}

export function makeExperience(overrides?: Partial<Experience>): Experience {
  return {
    id: "exp_test_001",
    title: "Use overflow-hidden for sidebar containers",
    domain: "frontend",
    taskType: "bugfix",
    scope: "domain",
    triggers: ["css", "overflow", "sidebar"],
    problem: "Sidebar overflows on window resize causing layout shift",
    recommendation:
      "Use overflow: hidden instead of overflow: scroll for sidebar containers to prevent layout shift on resize",
    avoid: ["overflow: scroll on sidebar containers"],
    applyWhen: [
      "Working with sidebar or panel components",
      "Fixing layout shift issues",
    ],
    evidence: ["ep_test_001: scroll caused layout shift on resize"],
    sourceEpisodeIds: ["ep_test_001"],
    confidence: 0.85,
    version: 1,
    status: "active",
    createdAt: "2026-06-01T11:00:00Z",
    updatedAt: "2026-06-01T11:00:00Z",
    ...overrides,
  };
}

export function makeCandidate(
  overrides?: Partial<ExperienceCandidate>,
): ExperienceCandidate {
  return {
    title: "Use overflow-hidden for sidebar containers",
    domain: "frontend",
    taskType: "bugfix",
    triggers: ["css", "overflow", "sidebar"],
    problem: "Sidebar overflows on window resize",
    recommendation:
      "Use overflow: hidden instead of overflow: scroll for sidebar containers to prevent layout shift on resize",
    avoid: ["overflow: scroll on sidebar containers"],
    applyWhen: ["Working with sidebar or panel components"],
    evidence: ["scroll caused layout shift on resize"],
    confidence: 0.85,
    ...overrides,
  };
}
