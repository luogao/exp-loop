import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  IngestSource,
  ListSessionsOpts,
  SessionRef,
  Session,
  SessionMessage,
} from "../types.js";

export class GeminiIngestSource implements IngestSource {
  readonly name = "gemini";
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".gemini");
  }

  async listSessions(opts?: ListSessionsOpts): Promise<SessionRef[]> {
    const refs: SessionRef[] = [];
    const tmpDir = join(this.baseDir, "tmp");

    let projectDirs: string[];
    try {
      projectDirs = await readdir(tmpDir);
    } catch {
      return [];
    }

    for (const projectName of projectDirs) {
      const projectRoot = await readProjectRoot(join(tmpDir, projectName));
      if (opts?.projectPath && projectRoot !== opts.projectPath) continue;

      const chatsDir = join(tmpDir, projectName, "chats");
      let chatFiles: string[];
      try {
        chatFiles = await readdir(chatsDir);
      } catch {
        continue;
      }

      for (const file of chatFiles) {
        if (!file.endsWith(".json")) continue;
        const filePath = join(chatsDir, file);

        try {
          const meta = await readGeminiMeta(filePath);
          if (!meta.sessionId) continue;
          if (opts?.after && meta.startedAt && meta.startedAt < opts.after) continue;

          refs.push({
            id: meta.sessionId,
            path: filePath,
            projectPath: projectRoot,
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
    const data = JSON.parse(content);

    const messages: SessionMessage[] = [];
    const rawMessages = data.messages as Array<Record<string, unknown>> ?? [];

    for (const msg of rawMessages) {
      const type = msg.type as string;
      let role: SessionMessage["role"];

      if (type === "user") {
        role = "user";
      } else if (type === "gemini") {
        role = "assistant";
      } else {
        continue;
      }

      let text = extractGeminiContent(msg.content);
      const toolCalls = msg.toolCalls as Array<Record<string, unknown>> | undefined;
      if (toolCalls && toolCalls.length > 0) {
        const toolTexts = toolCalls
          .map((tc) => `[Tool: ${tc.name}]`)
          .filter(Boolean);
        if (toolTexts.length > 0) {
          text = text ? text + "\n" + toolTexts.join("\n") : toolTexts.join("\n");
        }
      }

      if (!text) continue;

      const timestamp = normalizeTimestamp(msg.timestamp);
      messages.push({ role, content: text, timestamp });
    }

    const startedAt = normalizeTimestamp(data.startTime) ?? new Date().toISOString();
    const endedAt = normalizeTimestamp(data.lastUpdated) ?? startedAt;

    return {
      id: ref.id,
      source: "gemini",
      projectPath: ref.projectPath,
      title: ref.title,
      messages,
      startedAt,
      endedAt,
    };
  }
}

interface GeminiMeta {
  sessionId?: string;
  title?: string;
  startedAt?: string;
  endedAt?: string;
}

async function readGeminiMeta(filePath: string): Promise<GeminiMeta> {
  const content = await readFile(filePath, "utf-8");
  const data = JSON.parse(content);

  const sessionId = data.sessionId as string | undefined;
  const startedAt = normalizeTimestamp(data.startTime);
  const endedAt = normalizeTimestamp(data.lastUpdated);

  let title: string | undefined;
  const messages = data.messages as Array<Record<string, unknown>> | undefined;
  if (messages) {
    for (const msg of messages) {
      if (msg.type === "user" && typeof msg.content === "string" && msg.content.trim()) {
        title = msg.content.slice(0, 80);
        break;
      }
    }
  }

  return { sessionId, title, startedAt, endedAt };
}

async function readProjectRoot(projectDir: string): Promise<string | undefined> {
  try {
    const content = await readFile(join(projectDir, ".project_root"), "utf-8");
    return content.trim() || undefined;
  } catch {
    return undefined;
  }
}

function extractGeminiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .filter((item) => typeof item.text === "string")
      .map((item) => item.text as string)
      .join("\n");
  }
  return "";
}

function normalizeTimestamp(ts: unknown): string | undefined {
  if (typeof ts === "string") {
    if (/^\d+$/.test(ts)) {
      const num = parseInt(ts, 10);
      return new Date(num > 1e12 ? num : num * 1000).toISOString();
    }
    return ts;
  }
  if (typeof ts === "number") {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString();
  }
  return undefined;
}
