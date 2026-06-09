import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import type { SessionRef } from "../api/types";

interface SessionProgress {
  ref: SessionRef;
  status: "processing" | "complete" | "error";
  error?: string;
}

interface LlmStatus {
  status: string;
  detail?: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  detail?: string;
}

export function useObserveProgress() {
  const [sessions, setSessions] = useState<SessionProgress[]>([]);
  const [active, setActive] = useState(false);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | undefined>();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<{ method: string; params: Record<string, unknown> }>(
      "sidecar:notification",
      (event) => {
        const { method, params } = event.payload;

        if (method === "observer.sessionStart") {
          const ref = params.ref as unknown as SessionRef;
          setSessions((prev) => [
            ...prev,
            { ref, status: "processing" },
          ]);
        } else if (method === "observer.sessionComplete") {
          const ref = params.ref as unknown as SessionRef;
          setSessions((prev) =>
            prev.map((s) =>
              s.ref.id === ref.id ? { ...s, status: "complete" } : s,
            ),
          );
        } else if (method === "observer.sessionError") {
          const ref = params.ref as unknown as SessionRef;
          setSessions((prev) =>
            prev.map((s) =>
              s.ref.id === ref.id
                ? { ...s, status: "error", error: params.error as string }
                : s,
            ),
          );
        } else if (method === "llm.status") {
          setLlmStatus(params as unknown as LlmStatus);
        } else if (method === "log") {
          setLogs((prev) => [...prev, params as unknown as LogEntry]);
        }
      },
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const reset = useCallback(() => {
    setSessions([]);
    setActive(false);
    setLlmStatus(undefined);
    setLogs([]);
  }, []);

  const start = useCallback(() => {
    setSessions([]);
    setLogs([]);
    setLlmStatus(undefined);
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setLlmStatus(undefined);
  }, []);

  return { sessions, active, llmStatus, logs, start, stop, reset };
}
