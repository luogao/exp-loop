import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type {
  IngestSource,
  ListSessionsOpts,
  SessionRef,
  Session,
  SessionMessage,
} from "../types.js";

export class HermesIngestSource implements IngestSource {
  readonly name = "hermes";
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".hermes");
  }

  async listSessions(opts?: ListSessionsOpts): Promise<SessionRef[]> {
    const refs: SessionRef[] = [];
    const sessionsDir = join(this.baseDir, "sessions");

    let files: string[];
    try {
      files = await readdir(sessionsDir);
    } catch {
      return [];
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl") && !file.endsWith(".json")) continue;
      const filePath = join(sessionsDir, file);

      try {
        const meta = await readHermesMeta(filePath);
        const sessionId = meta.sessionId ?? basename(file, file.endsWith(".jsonl") ? ".jsonl" : ".json");
        if (opts?.projectPath && meta.cwd !== opts.projectPath) continue;
        if (opts?.after && meta.startedAt && meta.startedAt < opts.after) continue;

        refs.push({
          id: sessionId,
          path: filePath,
          projectPath: meta.cwd,
          title: meta.title,
          startedAt: meta.startedAt,
          endedAt: meta.endedAt,
        });
      } catch {
        continue;
      }
    }

    refs.sort((a, b) => {
      if (!a.startedAt || !b.startedAt) return 0;
      return a.startedAt < b.startedAt ? 1 : -1;
    });

    if (opts?.limit) return refs.slice(0, opts.limit);
    return refs;
  }

  async parseSession(ref: SessionRef): Promise<Session> {
    const content = await readFile(ref.path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    const messages: SessionMessage[] = [];
    let firstTimestamp: string | undefined;
    let lastTimestamp: string | undefined;
    let title: string | undefined;

    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const timestamp = normalizeTimestamp(entry.timestamp ?? entry.ts);
      if (timestamp) {
        if (!firstTimestamp) firstTimestamp = timestamp;
        lastTimestamp = timestamp;
      }

      const type = entry.type as string | undefined;

      if (type === "session" || type === "init") {
        if (!title && entry.title) title = entry.title as string;
        continue;
      }

      if (type === "message") {
        const msg = entry.message as Record<string, unknown> | undefined;
        if (!msg) continue;
        const role = normalizeRole((msg.role as string) ?? "assistant");
        const text = extractText(msg.content);
        if (text) {
          messages.push({ role, content: text, timestamp });
        }
        continue;
      }

      // Flat format: has role + content directly
      if (entry.role && entry.content !== undefined) {
        const role = normalizeRole(entry.role as string);
        const text = extractText(entry.content);
        if (text) {
          messages.push({ role, content: text, timestamp });
        }
      }
    }

    return {
      id: ref.id,
      source: "hermes",
      projectPath: ref.projectPath,
      title: title ?? ref.title,
      messages,
      startedAt: firstTimestamp ?? new Date().toISOString(),
      endedAt: lastTimestamp ?? new Date().toISOString(),
    };
  }
}

interface HermesMeta {
  sessionId?: string;
  title?: string;
  cwd?: string;
  startedAt?: string;
  endedAt?: string;
}

async function readHermesMeta(filePath: string): Promise<HermesMeta> {
  const content = await readFile(filePath, "utf-8");
  const allLines = content.split("\n").filter((l) => l.trim());
  const headLines = allLines.slice(0, 30);
  const tailLines = allLines.slice(-10);

  let sessionId: string | undefined;
  let title: string | undefined;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let firstUserMsg: string | undefined;

  for (const line of headLines) {
    try {
      const entry = JSON.parse(line);
      const ts = normalizeTimestamp(entry.timestamp ?? entry.ts);
      if (ts && !startedAt) startedAt = ts;

      const type = entry.type as string | undefined;
      if (type === "session" || type === "init") {
        sessionId = (entry.id ?? entry.sessionId) as string | undefined;
        if (entry.title) title = entry.title as string;
        cwd = (entry.cwd ?? entry.directory) as string | undefined;
      }

      if (!firstUserMsg) {
        const role = type === "message"
          ? (entry.message as Record<string, unknown>)?.role
          : entry.role;
        if (role === "user") {
          const msgContent = type === "message"
            ? (entry.message as Record<string, unknown>)?.content
            : entry.content;
          const text = extractText(msgContent);
          if (text) firstUserMsg = text.slice(0, 80);
        }
      }
    } catch {
      continue;
    }
  }

  let endedAt: string | undefined;
  for (let i = tailLines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(tailLines[i]);
      const ts = normalizeTimestamp(entry.timestamp ?? entry.ts);
      if (ts) { endedAt = ts; break; }
    } catch {
      continue;
    }
  }

  return {
    sessionId,
    title: title ?? firstUserMsg,
    cwd,
    startedAt,
    endedAt,
  };
}

const VALID_ROLES = new Set(["user", "assistant", "tool_use", "tool_result", "system"]);

function normalizeRole(role: string): SessionMessage["role"] {
  if (VALID_ROLES.has(role)) return role as SessionMessage["role"];
  return "assistant";
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .map((item) => {
        if (typeof item.text === "string") return item.text;
        if (typeof item.input_text === "string") return item.input_text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}

function normalizeTimestamp(ts: unknown): string | undefined {
  if (typeof ts === "string") return ts;
  if (typeof ts === "number") {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString();
  }
  return undefined;
}
