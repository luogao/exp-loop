import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createObserver } from "../src/observer.js";
import type {
  IngestSource,
  Session,
  SessionRef,
  ObserverCallbacks,
} from "../src/types.js";

function makeSession(id: string, messages: Session["messages"]): Session {
  return {
    id,
    source: "test",
    messages,
    startedAt: "2026-06-01T10:00:00.000Z",
    endedAt: "2026-06-01T10:05:00.000Z",
  };
}

function makeRef(id: string): SessionRef {
  return { id, path: `/fake/${id}.jsonl` };
}

function makeMockSource(sessions: Map<string, Session>): IngestSource {
  return {
    name: "test",
    async listSessions() {
      return [...sessions.keys()].map((id) => makeRef(id));
    },
    async parseSession(ref: SessionRef) {
      const session = sessions.get(ref.id);
      if (!session) throw new Error(`Session not found: ${ref.id}`);
      return session;
    },
  };
}

const stubLlm = async () => "[]";

describe("createObserver", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "observer-test-"));
  });

  it("processes sessions and creates episodes", async () => {
    const sessions = new Map([
      [
        "s1",
        makeSession("s1", [
          { role: "user", content: "Fix the login bug" },
          {
            role: "tool_use",
            content: "Read",
            toolName: "Read",
            toolInput: { path: "auth.ts" },
          },
          { role: "tool_result", content: "file contents..." },
          { role: "assistant", content: "Fixed the bug by updating auth.ts" },
        ]),
      ],
    ]);

    const observer = createObserver({
      source: makeMockSource(sessions),
      dataDir,
      llm: stubLlm,
    });

    const result = await observer.observe();

    expect(result.sessionsProcessed).toBe(1);
    expect(result.episodesCreated).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("skips already-processed sessions on second run", async () => {
    const sessions = new Map([
      [
        "s1",
        makeSession("s1", [
          { role: "user", content: "Add dark mode" },
          { role: "assistant", content: "Done, dark mode added" },
        ]),
      ],
    ]);

    const observer = createObserver({
      source: makeMockSource(sessions),
      dataDir,
      llm: stubLlm,
    });

    const first = await observer.observe();
    expect(first.sessionsProcessed).toBe(1);

    const second = await observer.observe();
    expect(second.sessionsProcessed).toBe(0);
    expect(second.episodesCreated).toBe(0);
  });

  it("records processed sessions and exposes them via listProcessed", async () => {
    const sessions = new Map([
      [
        "s1",
        makeSession("s1", [
          { role: "user", content: "Write tests" },
          { role: "assistant", content: "Tests written" },
        ]),
      ],
    ]);

    const observer = createObserver({
      source: makeMockSource(sessions),
      dataDir,
      llm: stubLlm,
    });

    await observer.observe();
    const processed = await observer.listProcessed();

    expect(processed["s1"]).toBeDefined();
    expect(processed["s1"].processedAt).toBeDefined();
    expect(processed["s1"].episodeIds).toHaveLength(1);
  });

  it("handles parse errors gracefully and continues", async () => {
    const source: IngestSource = {
      name: "test",
      async listSessions() {
        return [makeRef("bad"), makeRef("good")];
      },
      async parseSession(ref: SessionRef) {
        if (ref.id === "bad") throw new Error("corrupt file");
        return makeSession("good", [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ]);
      },
    };

    const observer = createObserver({ source, dataDir, llm: stubLlm });
    const result = await observer.observe();

    expect(result.sessionsProcessed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sessionId).toBe("bad");
    expect(result.errors[0].error).toBe("corrupt file");
  });

  it("invokes callbacks at the right time", async () => {
    const sessions = new Map([
      [
        "s1",
        makeSession("s1", [
          { role: "user", content: "Deploy" },
          { role: "assistant", content: "Deployed" },
        ]),
      ],
    ]);

    const onSessionStart = vi.fn();
    const onSessionComplete = vi.fn();
    const onSessionError = vi.fn();

    const observer = createObserver({
      source: makeMockSource(sessions),
      dataDir,
      llm: stubLlm,
      callbacks: { onSessionStart, onSessionComplete, onSessionError },
    });

    await observer.observe();

    expect(onSessionStart).toHaveBeenCalledTimes(1);
    expect(onSessionStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
    );
    expect(onSessionComplete).toHaveBeenCalledTimes(1);
    expect(onSessionError).not.toHaveBeenCalled();
  });

  it("invokes error callback on parse failure", async () => {
    const source: IngestSource = {
      name: "test",
      async listSessions() {
        return [makeRef("fail")];
      },
      async parseSession() {
        throw new Error("disk read error");
      },
    };

    const onSessionError = vi.fn();
    const observer = createObserver({
      source,
      dataDir,
      llm: stubLlm,
      callbacks: { onSessionError },
    });

    await observer.observe();

    expect(onSessionError).toHaveBeenCalledTimes(1);
    expect(onSessionError).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fail" }),
      expect.objectContaining({ message: "disk read error" }),
    );
  });

  it("skips sessions with no user messages (empty episodes)", async () => {
    const sessions = new Map([
      [
        "empty",
        makeSession("empty", [
          { role: "assistant", content: "No user message here" },
        ]),
      ],
    ]);

    const observer = createObserver({
      source: makeMockSource(sessions),
      dataDir,
      llm: stubLlm,
    });

    const result = await observer.observe();

    expect(result.sessionsProcessed).toBe(1);
    expect(result.episodesCreated).toBe(0);
  });

  it("processes multiple sessions in a single run", async () => {
    const sessions = new Map([
      [
        "s1",
        makeSession("s1", [
          { role: "user", content: "Task one" },
          { role: "assistant", content: "Done" },
        ]),
      ],
      [
        "s2",
        makeSession("s2", [
          { role: "user", content: "Task two" },
          { role: "assistant", content: "Done" },
        ]),
      ],
      [
        "s3",
        makeSession("s3", [
          { role: "user", content: "Task three" },
          { role: "assistant", content: "Done" },
        ]),
      ],
    ]);

    const observer = createObserver({
      source: makeMockSource(sessions),
      dataDir,
      llm: stubLlm,
    });

    const result = await observer.observe();

    expect(result.sessionsProcessed).toBe(3);
    expect(result.episodesCreated).toBe(3);

    const processed = await observer.listProcessed();
    expect(Object.keys(processed)).toHaveLength(3);
  });
});
