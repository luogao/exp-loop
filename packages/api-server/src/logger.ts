import { mkdir, appendFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Emitter } from "./server.js";

export type LogLevel = "info" | "llm" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  detail?: string;
}

export function createLogger(dataDir: string, emit?: Emitter) {
  const logPath = join(dataDir, "logs", "learn.jsonl");

  async function log(level: LogLevel, message: string, detail?: string) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      detail,
    };

    emit?.("log", entry as unknown as Record<string, unknown>);

    try {
      await mkdir(dirname(logPath), { recursive: true });
      await appendFile(logPath, JSON.stringify(entry) + "\n");
    } catch {
      // best effort
    }
  }

  return {
    info: (msg: string, detail?: string) => log("info", msg, detail),
    llm: (msg: string, detail?: string) => log("llm", msg, detail),
    warn: (msg: string, detail?: string) => log("warn", msg, detail),
    error: (msg: string, detail?: string) => log("error", msg, detail),
  };
}
