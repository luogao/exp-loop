import { readdir, readFile, open, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type {
  IngestSource,
  ListSessionsOpts,
  SessionRef,
  Session,
  SessionMessage,
} from "../types.js";

export class ClaudeCodeIngestSource implements IngestSource {
  readonly name = "claude-code";
  private readonly projectsDir: string;

  constructor(projectsDir?: string) {
    this.projectsDir =
      projectsDir ?? join(homedir(), ".claude", "projects");
  }

  async listSessions(opts?: ListSessionsOpts): Promise<SessionRef[]> {
    const refs: SessionRef[] = [];
    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.projectsDir);
    } catch {
      return [];
    }

    for (const dirName of projectDirs) {
      const projectDir = join(this.projectsDir, dirName);
      const jsonlFiles = await collectJsonlFiles(projectDir);

      for (const filePath of jsonlFiles) {
        const file = basename(filePath);
        if (file.startsWith("agent-")) continue;

        try {
          const meta = await readSessionMeta(filePath);

          if (opts?.projectPath && meta.cwd !== opts.projectPath) continue;
          if (opts?.after && meta.startedAt && meta.startedAt < opts.after) {
            continue;
          }

          refs.push({
            id: basename(file, ".jsonl"),
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

    if (opts?.limit && refs.length > opts.limit) {
      return refs.slice(0, opts.limit);
    }
    return refs;
  }

  async parseSession(ref: SessionRef): Promise<Session> {
    const content = await readFile(ref.path, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    const messages: SessionMessage[] = [];
    let title: string | undefined;
    let firstTimestamp: string | undefined;
    let lastTimestamp: string | undefined;

    for (const line of lines) {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      const timestamp = entry.timestamp as string | undefined;
      if (timestamp) {
        if (!firstTimestamp) firstTimestamp = timestamp;
        lastTimestamp = timestamp;
      }

      if (entry.isSidechain) continue;

      const type = entry.type as string;

      if (type === "custom-title") {
        title = entry.customTitle as string;
        continue;
      }
      if (type === "ai-title" && !title) {
        title = entry.title as string;
        continue;
      }

      if (type === "user") {
        const text = extractUserContent(entry);
        if (text) {
          messages.push({ role: "user", content: text, timestamp });
        }
        continue;
      }

      if (type === "assistant") {
        const parsed = extractAssistantContent(entry);
        for (const msg of parsed) {
          msg.timestamp = timestamp;
          messages.push(msg);
        }
        continue;
      }
    }

    return {
      id: ref.id,
      source: "claude-code",
      projectPath: ref.projectPath,
      title: title ?? ref.title,
      messages,
      startedAt: firstTimestamp ?? new Date().toISOString(),
      endedAt: lastTimestamp ?? new Date().toISOString(),
    };
  }
}

interface SessionMeta {
  title?: string;
  cwd?: string;
  startedAt?: string;
  endedAt?: string;
}

const HEAD_LINES = 10;
const TAIL_BYTES = 16384;
const TAIL_LINES = 30;

async function readSessionMeta(filePath: string): Promise<SessionMeta> {
  const { headLines, tailLines } = await readHeadTail(filePath);

  let title: string | undefined;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  for (const line of headLines) {
    try {
      const entry = JSON.parse(line);
      if (!startedAt && entry.timestamp) startedAt = entry.timestamp;
      if (!cwd && entry.cwd) cwd = entry.cwd;
      if (entry.type === "ai-title" && entry.title) title = entry.title;
    } catch {
      continue;
    }
  }

  for (let i = tailLines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(tailLines[i]);
      if (entry.type === "custom-title" && entry.customTitle) {
        title = entry.customTitle;
      }
      if (!endedAt && entry.timestamp) {
        endedAt = entry.timestamp;
      }
    } catch {
      continue;
    }
  }

  return { title, cwd, startedAt, endedAt };
}

async function readHeadTail(
  filePath: string,
): Promise<{ headLines: string[]; tailLines: string[] }> {
  const fileStat = await stat(filePath);
  const size = fileStat.size;

  if (size < TAIL_BYTES) {
    const content = await readFile(filePath, "utf-8");
    const allLines = content.split("\n").filter((l) => l.trim());
    return {
      headLines: allLines.slice(0, HEAD_LINES),
      tailLines: allLines.slice(-TAIL_LINES),
    };
  }

  const fh = await open(filePath, "r");
  try {
    const headBuf = Buffer.alloc(Math.min(size, TAIL_BYTES));
    await fh.read(headBuf, 0, headBuf.length, 0);
    const headLines = headBuf
      .toString("utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, HEAD_LINES);

    const tailBuf = Buffer.alloc(TAIL_BYTES);
    await fh.read(tailBuf, 0, TAIL_BYTES, size - TAIL_BYTES);
    const tailRaw = tailBuf.toString("utf-8").split("\n").filter((l) => l.trim());
    const tailLines = tailRaw.slice(1).slice(-TAIL_LINES);

    return { headLines, tailLines };
  } finally {
    await fh.close();
  }
}

function extractUserContent(entry: Record<string, unknown>): string {
  if (typeof entry.content === "string") return entry.content;

  const message = entry.message as Record<string, unknown> | undefined;
  if (!message) return "";

  if (typeof message.content === "string") return message.content;

  if (Array.isArray(message.content)) {
    return (message.content as Array<Record<string, unknown>>)
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n");
  }
  return "";
}

function extractAssistantContent(
  entry: Record<string, unknown>,
): SessionMessage[] {
  const messages: SessionMessage[] = [];
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message) return messages;

  const content = message.content;
  if (typeof content === "string") {
    messages.push({ role: "assistant", content });
    return messages;
  }

  if (!Array.isArray(content)) return messages;

  const blocks = content as Array<Record<string, unknown>>;
  const textParts: string[] = [];

  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text as string);
    } else if (block.type === "tool_use") {
      messages.push({
        role: "tool_use",
        content: (block.name as string) ?? "unknown_tool",
        toolName: block.name as string,
        toolInput: block.input,
      });
    } else if (block.type === "tool_result") {
      const resultContent =
        typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content ?? "");
      messages.push({
        role: "tool_result",
        content: resultContent,
        toolName: block.tool_use_id as string,
        toolOutput: block.content,
      });
    }
  }

  if (textParts.length > 0) {
    messages.unshift({ role: "assistant", content: textParts.join("\n") });
  }

  return messages;
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
    // directory doesn't exist or not readable
  }
  return results;
}

export { ClaudeCodeIngestSource as default };
