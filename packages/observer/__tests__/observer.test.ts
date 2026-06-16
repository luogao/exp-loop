import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createObserver } from "../src/observer.js";
import type {
  IngestSource,
  Session,
  SessionMessage,
  SessionRef,
  ObserverCallbacks,
  ParseSessionOpts,
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

  // ── Incremental processing ───────────────────────────────────────────
  it("re-processes a growing session incrementally, advancing the watermark", async () => {
    // A source backed by a mutable list of "lines", each line = one message.
    // parseSession respects startLine and reports messagesEndLine so the observer
    // can track a watermark.
    let lines: SessionMessage[] = [
      { role: "user", content: "Initial task" },
      { role: "assistant", content: "Initial done" },
    ];

    const growingSource: IngestSource = {
      name: "growing",
      supportsIncremental: true,
      async listSessions() {
        return [makeRef("grow")];
      },
      async parseSession(_ref: SessionRef, opts?: ParseSessionOpts) {
        const start = opts?.startLine ?? 0;
        const slice = lines.slice(start);
        const session: Session = {
          id: "grow",
          source: "growing",
          messages: slice,
          startedAt: "2026-06-01T10:00:00.000Z",
          endedAt: "2026-06-01T10:05:00.000Z",
          messagesStartLine: start,
          messagesEndLine: lines.length,
        };
        return session;
      },
    };

    const observer = createObserver({
      source: growingSource,
      dataDir,
      llm: stubLlm,
    });

    // First pass: full parse.
    const r1 = await observer.observe();
    expect(r1.sessionsProcessed).toBe(1);
    const after1 = await observer.listProcessed();
    expect(after1["grow"].processedLineCount).toBe(2);
    expect(after1["grow"].episodeIds).toHaveLength(1);

    // Second pass with no new lines → delta is empty, watermark unchanged, no new episode.
    const r2 = await observer.observe();
    expect(r2.sessionsProcessed).toBe(0);
    const after2 = await observer.listProcessed();
    expect(after2["grow"].processedLineCount).toBe(2);
    expect(after2["grow"].episodeIds).toHaveLength(1);

    // Append new content → second observe produces a delta episode.
    lines.push(
      { role: "user", content: "Follow-up task" },
      { role: "assistant", content: "Follow-up done" },
    );
    const r3 = await observer.observe();
    expect(r3.sessionsProcessed).toBe(1);
    const after3 = await observer.listProcessed();
    expect(after3["grow"].processedLineCount).toBe(4);
    expect(after3["grow"].episodeIds).toHaveLength(2);
    expect(after3["grow"].lastDeltaAt).toBeTruthy();
  });

  it("does not re-process legacy records that have no watermark", async () => {
    const sessions = new Map([
      [
        "legacy",
        makeSession("legacy", [
          { role: "user", content: "Old task" },
          { role: "assistant", content: "Done" },
        ]),
      ],
    ]);
    // Source does NOT declare supportsIncremental → behaves like legacy.
    const legacySource: IngestSource = {
      name: "legacy",
      async listSessions() {
        return [...sessions.keys()].map((id) => makeRef(id));
      },
      async parseSession(ref: SessionRef) {
        const s = sessions.get(ref.id)!;
        return s;
      },
    };

    const observer = createObserver({
      source: legacySource,
      dataDir,
      llm: stubLlm,
    });

    await observer.observe();
    const after1 = await observer.listProcessed();
    expect(after1["legacy"].processedLineCount).toBeUndefined();

    // Re-observe → skipped (no watermark, backwards-compatible boolean behavior).
    const r2 = await observer.observe();
    expect(r2.sessionsProcessed).toBe(0);
  });

  it("resetProcessed allows a session to be re-parsed", async () => {
    const sessions = new Map([
      [
        "s",
        makeSession("s", [
          { role: "user", content: "Task" },
          { role: "assistant", content: "Done" },
        ]),
      ],
    ]);
    const observer = createObserver({
      source: makeMockSource(sessions),
      dataDir,
      llm: stubLlm,
    });

    await observer.observe();
    expect(Object.keys(await observer.listProcessed())).toHaveLength(1);

    const removed = await observer.resetProcessed("s");
    expect(removed).toBe(true);
    expect(Object.keys(await observer.listProcessed())).toHaveLength(0);

    // Re-observe processes it again.
    const r = await observer.observe();
    expect(r.sessionsProcessed).toBe(1);
  });
});
