import { readdir, readFile, open, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type {
  IngestSource,
  ListSessionsOpts,
  ParseSessionOpts,
  SessionRef,
  Session,
  SessionMessage,
} from "../types.js";

export class ClaudeCodeIngestSource implements IngestSource {
  readonly name = "claude-code";
  readonly supportsIncremental = true;
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
          const fileStat = await stat(filePath);

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
            mtimeMs: fileStat.mtimeMs,
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

  async parseSession(ref: SessionRef, opts?: ParseSessionOpts): Promise<Session> {
    const startLine = Math.max(0, opts?.startLine ?? 0);
    const fileStat = await stat(ref.path).catch(() => null);
    const totalLines = fileStat ? await countLines(ref.path, fileStat.size) : 0;

    // Boundary case: file shrank (startLine beyond current end) → full re-parse from 0
    const effectiveStart = startLine >= totalLines ? 0 : startLine;
    const lines = await readLines(ref.path, effectiveStart);

    const { messages, title, firstTimestamp, lastTimestamp, consumedLines } =
      parseLines(lines);

    // messagesStartLine/EndLine are absolute JSONL line indices in the file.
    const messagesStartLine = effectiveStart;
    const messagesEndLine = effectiveStart + consumedLines;

    return {
      id: ref.id,
      source: "claude-code",
      projectPath: ref.projectPath,
      title: title ?? ref.title,
      messages,
      startedAt: firstTimestamp ?? ref.startedAt ?? new Date().toISOString(),
      endedAt: lastTimestamp ?? ref.endedAt ?? new Date().toISOString(),
      messagesStartLine,
      messagesEndLine,
    };
  }
}

/**
 * Parse an array of raw JSONL text lines into messages + metadata.
 * Returns how many of the leading lines were consumed (non-empty/parsed).
 */
function parseLines(lines: string[]): {
  messages: SessionMessage[];
  title: string | undefined;
  firstTimestamp: string | undefined;
  lastTimestamp: string | undefined;
  consumedLines: number;
} {
  const messages: SessionMessage[] = [];
  let title: string | undefined;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let consumedLines = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    consumedLines++;

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

  return { messages, title, firstTimestamp, lastTimestamp, consumedLines };
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

/**
 * Count total JSONL lines in a file (cheap streaming count by newline bytes).
 */
async function countLines(filePath: string, size: number): Promise<number> {
  if (size === 0) return 0;
  const fh = await open(filePath, "r");
  try {
    let count = 0;
    const buf = Buffer.alloc(65536);
    let pos = 0;
    while (pos < size) {
      const bytesToRead = Math.min(buf.length, size - pos);
      await fh.read(buf, 0, bytesToRead, pos);
      for (let i = 0; i < bytesToRead; i++) {
        if (buf[i] === 0x0a) count++;
      }
      pos += bytesToRead;
    }
    // A trailing newline means last line still counts as a complete line;
    // files typically end with \n, so count == number of lines.
    return count;
  } finally {
    await fh.close();
  }
}

/**
 * Read all JSONL lines starting from `startLine` (0-based).
 * Small files: read fully and slice. Large files: stream-skip the first
 * `startLine` newlines, then collect the remainder.
 */
async function readLines(filePath: string, startLine: number): Promise<string[]> {
  if (startLine <= 0) {
    const content = await readFile(filePath, "utf-8");
    return content.split("\n");
  }

  const fileStat = await stat(filePath);
  const size = fileStat.size;
  if (size === 0) return [];

  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(65536);
    let pos = 0;
    let lineCount = 0;
    let skipUntil = -1; // byte offset where the wanted region starts

    // Phase 1: scan forward counting newlines until we've passed startLine lines.
    while (pos < size && skipUntil < 0) {
      const bytesToRead = Math.min(buf.length, size - pos);
      await fh.read(buf, 0, bytesToRead, pos);
      for (let i = 0; i < bytesToRead; i++) {
        if (buf[i] === 0x0a) {
          lineCount++;
          if (lineCount >= startLine) {
            // This newline ends line (startLine-1); bytes after it begin line startLine.
            skipUntil = pos + i + 1;
            break;
          }
        }
      }
      pos += bytesToRead;
    }

    // If we never reached startLine (file has fewer lines), return empty.
    if (skipUntil < 0) return [];

    const remaining = size - skipUntil;
    const tailBuf = Buffer.alloc(remaining);
    await fh.read(tailBuf, 0, remaining, skipUntil);
    return tailBuf.toString("utf-8").split("\n");
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
