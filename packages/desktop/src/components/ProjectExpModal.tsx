import { useState } from "react";
import { X, Copy, CheckCircle2, RefreshCw } from "lucide-react";
import { ScopeBadge, StatusBadge, ConfidenceBadge, TriggerTag } from "./Badges";
import { useExperiences } from "../hooks/useApiQuery";
import { api } from "../api/client";
import type { Experience } from "../api/types";

export function ProjectExpModal({
  projectPath,
  projectName,
  onClose,
}: {
  projectPath: string;
  projectName: string;
  onClose: () => void;
}) {
  const { data: experiences, isLoading } = useExperiences();
  const [selected, setSelected] = useState<Experience | null>(null);
  const [copied, setCopied] = useState(false);
  const [syncState, setSyncState] = useState<{ status: "idle" | "syncing" | "done" | "error"; message?: string }>({ status: "idle" });

  const projectExps = experiences?.filter((exp) => exp.projectPath === projectPath) ?? [];

  const handleCopy = (exp: Experience) => {
    const text = `## ${exp.title}\n\n**场景：** ${exp.applyWhen.join("；")}\n**建议：** ${exp.recommendation}${exp.avoid?.length ? `\n**避免：** ${exp.avoid.join("；")}` : ""}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSync = async () => {
    setSyncState({ status: "syncing" });
    try {
      const result = await api.syncer.syncProject(projectPath);
      if (result.action === "unchanged") {
        setSyncState({ status: "done", message: "内容无变化" });
      } else {
        setSyncState({ status: "done", message: `已同步 ${result.experiencesWritten} 条经验到 ${result.path}` });
      }
      setTimeout(() => setSyncState({ status: "idle" }), 3000);
    } catch (e: any) {
      setSyncState({ status: "error", message: e.message || String(e) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-[900px] max-h-[600px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">{projectName}</h2>
            <span className="text-xs text-gray-400">{projectExps.length} 条经验</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncState.status === "syncing" || projectExps.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-blue-200 text-blue-600 rounded hover:bg-blue-50 disabled:opacity-40 transition-colors"
            >
              {syncState.status === "syncing" ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : syncState.status === "done" ? (
                <CheckCircle2 size={12} className="text-emerald-500" />
              ) : null}
              {syncState.status === "syncing" ? "同步中..." : "同步到项目 CLAUDE.md"}
            </button>
            {syncState.message && (
              <span className={`text-xs ${syncState.status === "error" ? "text-red-500" : "text-emerald-600"}`}>
                {syncState.message}
              </span>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
              <X size={16} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: list */}
          <div className="w-[320px] border-r border-gray-200 overflow-y-auto">
            {isLoading ? (
              <p className="p-4 text-xs text-gray-400">加载中...</p>
            ) : projectExps.length > 0 ? (
              <div className="py-1">
                {projectExps.map((exp) => (
                  <button
                    key={exp.id}
                    onClick={() => setSelected(exp)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${selected?.id === exp.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xs font-medium truncate flex-1">{exp.title}</span>
                      <ConfidenceBadge confidence={exp.confidence} />
                    </div>
                    <p className="text-xs text-gray-400 truncate">{exp.recommendation}</p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="p-4 text-xs text-gray-400">该项目暂无经验。</p>
            )}
          </div>

          {/* Right: detail */}
          <div className="flex-1 overflow-y-auto p-5">
            {selected ? (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold flex-1">{selected.title}</h3>
                  <button
                    onClick={() => handleCopy(selected)}
                    className="flex items-center gap-1 px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50"
                  >
                    {copied ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>

                <div className="flex gap-1.5 mb-4">
                  <ScopeBadge scope={selected.scope} />
                  <StatusBadge status={selected.status} />
                  <ConfidenceBadge confidence={selected.confidence} />
                </div>

                <div className="space-y-3 text-sm">
                  <div>
                    <h4 className="text-xs font-medium text-gray-500 mb-1">问题</h4>
                    <p className="text-gray-700">{selected.problem}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-medium text-gray-500 mb-1">建议</h4>
                    <p className="text-gray-700">{selected.recommendation}</p>
                  </div>
                  {selected.applyWhen.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-gray-500 mb-1">适用场景</h4>
                      <ul className="list-disc list-inside text-gray-600 text-xs space-y-0.5">
                        {selected.applyWhen.map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                  {selected.avoid && selected.avoid.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-gray-500 mb-1">避免</h4>
                      <ul className="list-disc list-inside text-red-600 text-xs space-y-0.5">
                        {selected.avoid.map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                  {selected.triggers.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {selected.triggers.map((t) => <TriggerTag key={t} trigger={t} />)}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-gray-300">
                选择左侧经验查看详情
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
