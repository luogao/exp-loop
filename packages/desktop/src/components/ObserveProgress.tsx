import type { SessionRef } from "../api/types";
import { Loader2, CheckCircle2, XCircle, Cpu, ScrollText } from "lucide-react";
import { useState } from "react";

interface SessionProgress {
  ref: SessionRef;
  status: "processing" | "complete" | "error";
  error?: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  detail?: string;
}

export function ObserveProgress({
  sessions,
  active,
  llmStatus,
  logs,
}: {
  sessions: SessionProgress[];
  active: boolean;
  llmStatus?: { status: string; detail?: string };
  logs: LogEntry[];
}) {
  const [showLogs, setShowLogs] = useState(false);

  if (!active && sessions.length === 0 && logs.length === 0) return null;

  const processing = sessions.filter((s) => s.status === "processing").length;
  const complete = sessions.filter((s) => s.status === "complete").length;
  const errors = sessions.filter((s) => s.status === "error").length;

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-center gap-2 mb-2">
          {active && <Loader2 size={16} className="animate-spin text-blue-600" />}
          <span className="text-sm font-medium text-blue-800">
            {active ? "正在学习..." : "学习完成"}
          </span>
          <span className="text-xs text-blue-600 ml-auto">
            {complete} 完成 / {processing} 处理中 / {errors} 错误
          </span>
        </div>

        {llmStatus && llmStatus.status === "calling" && (
          <div className="flex items-center gap-2 mb-2 p-2 rounded bg-amber-50 border border-amber-200">
            <Cpu size={14} className="text-amber-600 animate-pulse" />
            <span className="text-xs text-amber-700">
              LLM 分析中: {llmStatus.detail}
            </span>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {sessions.map((s) => (
              <div
                key={s.ref.id}
                className="flex items-center gap-2 text-xs text-gray-600"
              >
                {s.status === "processing" && (
                  <Loader2 size={12} className="animate-spin text-blue-500" />
                )}
                {s.status === "complete" && (
                  <CheckCircle2 size={12} className="text-emerald-500" />
                )}
                {s.status === "error" && (
                  <XCircle size={12} className="text-red-500" />
                )}
                <span className="truncate">
                  {s.ref.title || s.ref.id}
                </span>
                {s.error && (
                  <span className="text-red-500 ml-auto truncate max-w-48">{s.error}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {logs.length > 0 && (
        <div>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            <ScrollText size={12} />
            {showLogs ? "隐藏日志" : `查看日志 (${logs.length})`}
          </button>
          {showLogs && (
            <div className="mt-1 rounded border border-gray-200 bg-gray-50 p-2 max-h-48 overflow-y-auto font-mono text-xs">
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={
                    log.level === "error"
                      ? "text-red-600"
                      : log.level === "llm"
                        ? "text-amber-600"
                        : "text-gray-500"
                  }
                >
                  <span className="text-gray-300">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>{" "}
                  {log.message}
                  {log.detail && (
                    <span className="text-gray-400"> — {log.detail}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
