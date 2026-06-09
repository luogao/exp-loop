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

export class CodexIngestSource implements IngestSource {
  readonly name = "codex";
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".codex");
  }

  async listSessions(opts?: ListSessionsOpts): Promise<SessionRef[]> {
    const refs: SessionRef[] = [];
    const sessionDirs = [
      join(this.baseDir, "sessions"),
      join(this.baseDir, "archived_sessions"),
    ];

    for (const dir of sessionDirs) {
      const files = await collectJsonlFiles(dir);
      for (const filePath of files) {
        try {
          const meta = await readCodexMeta(filePath);
          if (!meta.sessionId) continue;
          if (meta.isSubagent) continue;
          if (opts?.projectPath && meta.cwd !== opts.projectPath) continue;
          if (opts?.after && meta.startedAt && meta.startedAt < opts.after) continue;

          refs.push({
            id: meta.sessionId,
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

    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const timestamp = normalizeTimestamp(entry.timestamp);
      if (timestamp) {
        if (!firstTimestamp) firstTimestamp = timestamp;
        lastTimestamp = timestamp;
      }

      const type = entry.type as string;
      if (type === "session_meta") continue;

      if (type === "response_item") {
        const payload = entry.payload as Record<string, unknown> | undefined;
        if (!payload) continue;

        const payloadType = payload.type as string;

        if (payloadType === "message") {
          const rawRole = (payload.role as string) ?? "assistant";
          const role = (rawRole === "user" ? "user" : "assistant") as SessionMessage["role"];
          const text = extractText(payload.content);
          if (text) {
            messages.push({ role, content: text, timestamp });
          }
        } else if (payloadType === "function_call") {
          const name = (payload.name as string) ?? "unknown_tool";
          messages.push({
            role: "tool_use",
            content: name,
            toolName: name,
            toolInput: payload.arguments,
            timestamp,
          });
        } else if (payloadType === "function_call_output") {
          const output = typeof payload.output === "string" ? payload.output : JSON.stringify(payload.output ?? "");
          messages.push({
            role: "tool_result",
            content: output,
            toolOutput: payload.output,
            timestamp,
          });
        }
      }
    }

    return {
      id: ref.id,
      source: "codex",
      projectPath: ref.projectPath,
      title: ref.title,
      messages,
      startedAt: firstTimestamp ?? new Date().toISOString(),
      endedAt: lastTimestamp ?? new Date().toISOString(),
    };
  }
}

interface CodexMeta {
  sessionId?: string;
  title?: string;
  cwd?: string;
  startedAt?: string;
  endedAt?: string;
  isSubagent: boolean;
}

async function readCodexMeta(filePath: string): Promise<CodexMeta> {
  const content = await readFile(filePath, "utf-8");
  const allLines = content.split("\n").filter((l) => l.trim());
  const headLines = allLines.slice(0, 10);
  const tailLines = allLines.slice(-30);

  let sessionId: string | undefined;
  let title: string | undefined;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let isSubagent = false;

  for (const line of headLines) {
    try {
      const entry = JSON.parse(line);
      const ts = normalizeTimestamp(entry.timestamp);
      if (ts && !startedAt) startedAt = ts;

      if (entry.type === "session_meta") {
        const payload = entry.payload as Record<string, unknown> | undefined;
        if (payload) {
          sessionId = payload.id as string;
          cwd = payload.cwd as string;
          const source = payload.source as Record<string, unknown> | undefined;
          if (source && "subagent" in source) isSubagent = true;
        }
      }

      if (entry.type === "response_item" && !title) {
        const payload = entry.payload as Record<string, unknown> | undefined;
        if (payload?.type === "message" && payload.role === "user") {
          const text = extractText(payload.content);
          if (text) title = text.slice(0, 80);
        }
      }
    } catch {
      continue;
    }
  }

  if (!sessionId) {
    const match = basename(filePath).match(
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
    );
    if (match) sessionId = match[0];
  }

  let endedAt: string | undefined;
  for (let i = tailLines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(tailLines[i]);
      const ts = normalizeTimestamp(entry.timestamp);
      if (ts) { endedAt = ts; break; }
    } catch {
      continue;
    }
  }

  return { sessionId, title, cwd, startedAt, endedAt, isSubagent };
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await collectJsonlFiles(fullPath);
        results.push(...sub);
      } else if (entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory doesn't exist
  }
  return results;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .map((item) => {
        if (item.type === "tool_use") return `[Tool: ${item.name}]`;
        if (typeof item.text === "string") return item.text as string;
        if (typeof item.input_text === "string") return item.input_text as string;
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
