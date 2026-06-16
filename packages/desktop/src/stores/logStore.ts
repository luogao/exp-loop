import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";

const MAX_LOG_ENTRIES = 500;

export interface LogEntry {
  timestamp: string;
  level: "info" | "llm" | "warn" | "error" | "stderr";
  message: string;
  detail?: string;
  source: "rpc" | "stderr";
}

interface LogState {
  logs: LogEntry[];
  initialized: boolean;
  addLog: (entry: LogEntry) => void;
  clearLogs: () => void;
  /** Call once from App.tsx to start listening. Returns cleanup fn. */
  initListeners: () => () => void;
}

export const useLogStore = create<LogState>((set, get) => ({
  logs: [],
  initialized: false,

  addLog: (entry) =>
    set((state) => {
      const next = [...state.logs, entry];
      return {
        logs:
          next.length > MAX_LOG_ENTRIES
            ? next.slice(next.length - MAX_LOG_ENTRIES)
            : next,
      };
    }),

  clearLogs: () => set({ logs: [] }),

  initListeners: () => {
    if (get().initialized) return () => {};
    set({ initialized: true });

    // Add a startup log to verify store → UI binding works
    get().addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "日志系统已初始化",
      source: "rpc",
    });

    const unlisteners: (() => void)[] = [];

    // Structured log notifications from stdout JSON-RPC
    listen<{ method: string; params: Record<string, unknown> }>(
      "sidecar:notification",
      (event) => {
        const { method, params } = event.payload;

        // Structured "log" notifications from logger
        if (method === "log") {
          get().addLog({
            timestamp: (params.timestamp as string) ?? new Date().toISOString(),
            level: (params.level as LogEntry["level"]) ?? "info",
            message: (params.message as string) ?? "",
            detail: params.detail as string | undefined,
            source: "rpc",
          });
          return;
        }

        // LLM status
        if (method === "llm.status" || method === "scheduler.llmStatus") {
          const status = params.status as string;
          const detail = params.detail as string | undefined;
          get().addLog({
            timestamp: new Date().toISOString(),
            level: status === "error" ? "error" : "llm",
            message: detail ?? `LLM ${status}`,
            source: "rpc",
          });
          return;
        }

        // Session lifecycle
        if (method === "observer.sessionStart" || method === "scheduler.sessionStart") {
          const ref = params.ref as { title?: string; id?: string } | undefined;
          get().addLog({
            timestamp: new Date().toISOString(),
            level: "info",
            message: `处理会话: ${ref?.title || ref?.id || "unknown"}`,
            source: "rpc",
          });
          return;
        }

        if (method === "observer.sessionComplete" || method === "scheduler.sessionComplete") {
          const ref = params.ref as { title?: string; id?: string } | undefined;
          const result = params.result as { newExperiences?: number } | undefined;
          get().addLog({
            timestamp: new Date().toISOString(),
            level: "info",
            message: `会话完成: ${ref?.title || ref?.id || "unknown"}`,
            detail: result?.newExperiences ? `${result.newExperiences} 条新经验` : undefined,
            source: "rpc",
          });
          return;
        }

        if (method === "observer.sessionError" || method === "scheduler.sessionError") {
          const ref = params.ref as { title?: string; id?: string } | undefined;
          get().addLog({
            timestamp: new Date().toISOString(),
            level: "error",
            message: `会话失败: ${ref?.title || ref?.id || "unknown"}`,
            detail: params.error as string | undefined,
            source: "rpc",
          });
          return;
        }

        // Scheduler process events
        if (method === "scheduler.processTriggered") {
          get().addLog({
            timestamp: new Date().toISOString(),
            level: "info",
            message: `触发处理: ${params.reason as string}`,
            source: "rpc",
          });
          return;
        }

        if (method === "scheduler.checkStart") {
          get().addLog({
            timestamp: new Date().toISOString(),
            level: "info",
            message: "检查新会话...",
            source: "rpc",
          });
          return;
        }

        if (method === "scheduler.checkComplete") {
          const hasNew = params.hasNew as boolean | undefined;
          if (hasNew) {
            get().addLog({
              timestamp: new Date().toISOString(),
              level: "info",
              message: "发现新会话",
              source: "rpc",
            });
          }
          return;
        }

        if (method === "scheduler.error") {
          get().addLog({
            timestamp: new Date().toISOString(),
            level: "error",
            message: `调度错误: ${params.error as string}`,
            source: "rpc",
          });
          return;
        }
      },
    ).then((fn) => unlisteners.push(fn));

    // Raw stderr lines
    listen<string>("sidecar:stderr", (event) => {
      const rawLine = event.payload;
      try {
        const parsed = JSON.parse(rawLine);
        get().addLog({
          timestamp: parsed.timestamp ?? new Date().toISOString(),
          level: parsed.level ?? "stderr",
          message: parsed.message ?? rawLine,
          detail: parsed.detail,
          source: "stderr",
        });
      } catch {
        get().addLog({
          timestamp: new Date().toISOString(),
          level: "stderr",
          message: rawLine,
          source: "stderr",
        });
      }
    }).then((fn) => unlisteners.push(fn));

    return () => unlisteners.forEach((fn) => fn());
  },
}));
