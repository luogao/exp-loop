import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { ClaudeCodeIngestSource } from "../src/sources/claude-code.js";

const fixturesDir = join(__dirname, "fixtures");

describe("ClaudeCodeIngestSource", () => {
  describe("parseSession", () => {
    let source: ClaudeCodeIngestSource;

    beforeEach(() => {
      source = new ClaudeCodeIngestSource(fixturesDir);
    });

    it("parses a normal session with user, assistant, and tool messages", async () => {
      const session = await source.parseSession({
        id: "sample-session",
        path: join(fixturesDir, "sample-session.jsonl"),
        projectPath: "/test/project",
      });

      expect(session.id).toBe("sample-session");
      expect(session.source).toBe("claude-code");
      expect(session.title).toBe("Fix sidebar CSS overflow");
      expect(session.startedAt).toBe("2026-06-01T10:00:00.000Z");
      expect(session.endedAt).toBe("2026-06-01T10:00:15.000Z");

      const userMessages = session.messages.filter((m) => m.role === "user");
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].content).toBe(
        "Fix the CSS overflow bug in the sidebar component",
      );

      const toolUses = session.messages.filter((m) => m.role === "tool_use");
      expect(toolUses).toHaveLength(2);
      expect(toolUses[0].toolName).toBe("Read");
      expect(toolUses[1].toolName).toBe("Edit");

      const assistantMessages = session.messages.filter(
        (m) => m.role === "assistant",
      );
      expect(assistantMessages.length).toBeGreaterThanOrEqual(2);
    });

    it("skips malformed lines and unknown types gracefully", async () => {
      const session = await source.parseSession({
        id: "malformed-session",
        path: join(fixturesDir, "malformed-session.jsonl"),
      });

      const userMessages = session.messages.filter((m) => m.role === "user");
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].content).toBe("Deploy the app");

      const assistantMessages = session.messages.filter(
        (m) => m.role === "assistant",
      );
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].content).toBe("I'll deploy the app now.");
    });

    it("returns empty messages for session with no conversation", async () => {
      const session = await source.parseSession({
        id: "empty-session",
        path: join(fixturesDir, "empty-session.jsonl"),
      });

      expect(session.messages).toHaveLength(0);
    });

    it("skips sidechain entries", async () => {
      const session = await source.parseSession({
        id: "error-session",
        path: join(fixturesDir, "error-session.jsonl"),
      });

      const userMessages = session.messages.filter((m) => m.role === "user");
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].content).toBe("Build the project");
    });

    it("prefers custom-title over ai-title", async () => {
      const session = await source.parseSession({
        id: "sample-session",
        path: join(fixturesDir, "sample-session.jsonl"),
        projectPath: "/test/project",
      });
      // sample-session has ai-title but no custom-title, so ai-title wins
      expect(session.title).toBe("Fix sidebar CSS overflow");
    });

    it("reports supportsIncremental and line range on full parse", async () => {
      expect(source.supportsIncremental).toBe(true);
      const session = await source.parseSession({
        id: "sample-session",
        path: join(fixturesDir, "sample-session.jsonl"),
      });
      expect(session.messagesStartLine).toBe(0);
      expect(session.messagesEndLine).toBe(8); // 8 non-empty lines consumed
    });

    it("parses only the tail when startLine is given (incremental delta)", async () => {
      const ref = {
        id: "sample-session",
        path: join(fixturesDir, "sample-session.jsonl"),
      };
      // First, full parse to learn the line count.
      const full = await source.parseSession(ref);
      const watermark = full.messagesEndLine!;

      // startLine beyond end of file → resets to full parse (boundary case).
      const overflow = await source.parseSession(ref, {
        startLine: watermark + 100,
      });
      expect(overflow.messages.length).toBe(full.messages.length);

      // startLine in the middle → only returns tail messages.
      const delta = await source.parseSession(ref, { startLine: 4 });
      expect(delta.messagesStartLine).toBe(4);
      expect(delta.messagesEndLine).toBe(8);
      // Tail has strictly fewer messages than the full parse.
      expect(delta.messages.length).toBeLessThan(full.messages.length);
      expect(delta.messages.length).toBeGreaterThan(0);
    });
  });
});
