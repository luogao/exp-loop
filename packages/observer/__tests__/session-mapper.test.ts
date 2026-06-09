import { describe, it, expect } from "vitest";
import { createSessionMapper } from "../src/session-mapper.js";
import type { Session } from "../src/types.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-session",
    source: "claude-code",
    messages: [],
    startedAt: "2026-06-01T10:00:00.000Z",
    endedAt: "2026-06-01T10:30:00.000Z",
    ...overrides,
  };
}

describe("createSessionMapper", () => {
  const mapper = createSessionMapper();

  it("maps a session with user and tool messages to an episode", () => {
    const session = makeSession({
      messages: [
        { role: "user", content: "Fix the CSS bug" },
        { role: "tool_use", content: "Read", toolName: "Read", toolInput: { file: "a.ts" } },
        { role: "tool_result", content: "file content", toolOutput: "file content" },
        { role: "assistant", content: "Fixed the bug by changing overflow." },
      ],
    });

    const episodes = mapper.map(session);
    expect(episodes).toHaveLength(1);

    const ep = episodes[0];
    expect(ep.task.description).toBe("Fix the CSS bug");
    expect(ep.status).toBe("success");
    expect(ep.trace.steps).toHaveLength(1);
    expect(ep.trace.steps[0].action).toBe("Read");
    expect(ep.startedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(ep.endedAt).toBe("2026-06-01T10:30:00.000Z");
  });

  it("returns empty array for session with no user messages", () => {
    const session = makeSession({
      messages: [
        { role: "assistant", content: "Hello" },
      ],
    });

    const episodes = mapper.map(session);
    expect(episodes).toHaveLength(0);
  });

  it("infers partial status when last assistant message contains error", () => {
    const session = makeSession({
      messages: [
        { role: "user", content: "Build the project" },
        { role: "assistant", content: "The build failed with an error." },
      ],
    });

    const episodes = mapper.map(session);
    expect(episodes[0].status).toBe("partial");
  });

  it("truncates task description to 500 characters", () => {
    const longMessage = "x".repeat(600);
    const session = makeSession({
      messages: [
        { role: "user", content: longMessage },
        { role: "assistant", content: "Done." },
      ],
    });

    const episodes = mapper.map(session);
    expect(episodes[0].task.description).toHaveLength(500);
  });

  it("creates a default conversation step when no tool calls exist", () => {
    const session = makeSession({
      messages: [
        { role: "user", content: "Explain this code" },
        { role: "assistant", content: "This code does X." },
      ],
    });

    const episodes = mapper.map(session);
    expect(episodes[0].trace.steps).toHaveLength(1);
    expect(episodes[0].trace.steps[0].action).toBe("conversation");
  });

  it("attaches tool output to the corresponding trace step", () => {
    const session = makeSession({
      messages: [
        { role: "user", content: "Read the file" },
        { role: "tool_use", content: "Read", toolName: "Read", toolInput: { path: "a.ts" } },
        { role: "tool_result", content: "file content here", toolOutput: "file content here" },
        { role: "assistant", content: "Here is the file." },
      ],
    });

    const episodes = mapper.map(session);
    expect(episodes[0].trace.steps[0].output).toBe("file content here");
  });
});
