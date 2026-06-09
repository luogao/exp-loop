import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { CodexIngestSource } from "../src/sources/codex.js";

const fixturesDir = join(__dirname, "fixtures");

describe("CodexIngestSource", () => {
  describe("parseSession", () => {
    it("parses a Codex JSONL session with messages and tool calls", async () => {
      const source = new CodexIngestSource(fixturesDir);
      const session = await source.parseSession({
        id: "codex-session-1",
        path: join(fixturesDir, "codex-session.jsonl"),
        projectPath: "/Users/test/my-project",
      });

      expect(session.id).toBe("codex-session-1");
      expect(session.source).toBe("codex");
      expect(session.startedAt).toBe("2026-06-01T10:00:00.000Z");
      expect(session.endedAt).toBe("2026-06-01T10:00:10.000Z");

      const userMessages = session.messages.filter((m) => m.role === "user");
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].content).toBe("Fix the login page");

      const assistantMessages = session.messages.filter(
        (m) => m.role === "assistant",
      );
      expect(assistantMessages).toHaveLength(2);

      const toolUses = session.messages.filter((m) => m.role === "tool_use");
      expect(toolUses).toHaveLength(1);
      expect(toolUses[0].toolName).toBe("read_file");

      const toolResults = session.messages.filter(
        (m) => m.role === "tool_result",
      );
      expect(toolResults).toHaveLength(1);
    });
  });
});
