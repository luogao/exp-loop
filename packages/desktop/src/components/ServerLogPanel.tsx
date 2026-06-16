import { useState, useRef, useEffect } from "react";
import { ScrollText, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useLogStore } from "../stores/logStore";

const LEVEL_COLORS: Record<string, string> = {
  error: "text-red-600",
  warn: "text-yellow-600",
  llm: "text-amber-600",
  info: "text-gray-500",
  stderr: "text-purple-500",
};

export function ServerLogPanel() {
  const { logs, clearLogs, initialized, addLog } = useLogStore();
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const addTestLog = () => {
    addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "测试日志 " + new Date().toLocaleTimeString(),
      source: "rpc",
    });
  };

  // Auto-scroll to bottom on new logs when panel is open
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isOpen]);

  // Always render the panel so the user can open it even before logs arrive
  return (
    <div className="border-t border-gray-200 bg-gray-50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full px-4 py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      >
        <ScrollText size={14} />
        <span>服务日志</span>
        {logs.length > 0 ? (
          <span className="text-gray-300">({logs.length})</span>
        ) : (
          <span className="text-gray-300 text-[10px]">{initialized ? "等待中..." : "未初始化"}</span>
        )}
        <span className="ml-auto">
          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {isOpen && (
        <div className="px-4 pb-3">
          <div className="flex justify-end mb-1 gap-2">
            <button
              onClick={addTestLog}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-600"
            >
              测试
            </button>
            <button
              onClick={clearLogs}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
            >
              <Trash2 size={11} />
              清除
            </button>
          </div>
          <div
            ref={scrollRef}
            className="rounded border border-gray-200 bg-white p-2 max-h-64 overflow-y-auto font-mono text-xs"
          >
            {logs.length === 0 ? (
              <div className="text-gray-300 text-center py-4">暂无日志</div>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  className={LEVEL_COLORS[log.level] ?? "text-gray-500"}
                >
                  <span className="text-gray-300">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>{" "}
                  {log.message}
                  {log.detail && (
                    <span className="text-gray-400"> — {log.detail}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
