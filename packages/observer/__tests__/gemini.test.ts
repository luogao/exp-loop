import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { GeminiIngestSource } from "../src/sources/gemini.js";

const fixturesDir = join(__dirname, "fixtures");

describe("GeminiIngestSource", () => {
  describe("parseSession", () => {
    it("parses a Gemini JSON session with user and assistant messages", async () => {
      const source = new GeminiIngestSource(fixturesDir);
      const session = await source.parseSession({
        id: "gemini-session-1",
        path: join(fixturesDir, "gemini-session.json"),
      });

      expect(session.id).toBe("gemini-session-1");
      expect(session.source).toBe("gemini");
      expect(session.startedAt).toBe("2026-06-01T10:00:00.000Z");
      expect(session.endedAt).toBe("2026-06-01T10:05:00.000Z");

      const userMessages = session.messages.filter((m) => m.role === "user");
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].content).toBe("Explain this function");

      const assistantMessages = session.messages.filter(
        (m) => m.role === "assistant",
      );
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].content).toContain("factorial");
      expect(assistantMessages[0].content).toContain("[Tool: read_file]");
    });

    it("skips info and error message types", async () => {
      const source = new GeminiIngestSource(fixturesDir);
      const session = await source.parseSession({
        id: "gemini-session-1",
        path: join(fixturesDir, "gemini-session.json"),
      });

      const allContent = session.messages.map((m) => m.content).join(" ");
      expect(allContent).not.toContain("System info");
    });
  });
});
