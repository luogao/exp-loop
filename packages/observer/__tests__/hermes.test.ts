import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { HermesIngestSource } from "../src/sources/hermes.js";

const fixturesDir = join(__dirname, "fixtures");

describe("HermesIngestSource", () => {
  describe("parseSession", () => {
    it("parses a Hermes JSONL session with nested message format", async () => {
      const source = new HermesIngestSource(fixturesDir);
      const session = await source.parseSession({
        id: "hermes-session-1",
        path: join(fixturesDir, "hermes-session.jsonl"),
      });

      expect(session.id).toBe("hermes-session-1");
      expect(session.source).toBe("hermes");
      expect(session.title).toBe("Debug API");
      expect(session.startedAt).toBe("2026-06-01T10:00:00.000Z");
      expect(session.endedAt).toBe("2026-06-01T10:00:10.000Z");

      const userMessages = session.messages.filter((m) => m.role === "user");
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].content).toContain("500");

      const assistantMessages = session.messages.filter(
        (m) => m.role === "assistant",
      );
      expect(assistantMessages).toHaveLength(2);
    });

    it("extracts title from session metadata line", async () => {
      const source = new HermesIngestSource(fixturesDir);
      const session = await source.parseSession({
        id: "hermes-session-1",
        path: join(fixturesDir, "hermes-session.jsonl"),
      });

      expect(session.title).toBe("Debug API");
    });
  });
});
