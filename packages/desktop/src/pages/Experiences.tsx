import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Folder } from "lucide-react";
import { useExperiences } from "../hooks/useApiQuery";
import { ScopeBadge, StatusBadge, ConfidenceBadge, TriggerTag } from "../components/Badges";
import { truncate } from "../lib/utils";
import type { Experience } from "../api/types";

function shortProjectPath(path?: string): string {
  if (!path) return "未知项目";
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments.slice(-2).join("/");
}

export function Experiences() {
  const [scopeFilter, setScopeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const query: Record<string, unknown> = {};
  if (scopeFilter) query.scope = scopeFilter;
  if (statusFilter) query.status = statusFilter;

  const { data: experiences, isLoading } = useExperiences(
    Object.keys(query).length > 0 ? query : undefined,
  );

  const grouped = useMemo(() => {
    if (!experiences) return [];
    const map = new Map<string, Experience[]>();
    for (const exp of experiences) {
      const key = exp.projectPath || "__unknown__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(exp);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === "__unknown__") return 1;
      if (b[0] === "__unknown__") return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [experiences]);

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-semibold mb-4">经验</h1>

      <div className="flex gap-3 mb-4">
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 rounded text-sm bg-white"
        >
          <option value="">所有范围</option>
          <option value="global">全局</option>
          <option value="domain">领域</option>
          <option value="project">项目</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 rounded text-sm bg-white"
        >
          <option value="">所有状态</option>
          <option value="active">活跃</option>
          <option value="draft">草稿</option>
          <option value="deprecated">已弃用</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">加载中...</p>
      ) : grouped.length > 0 ? (
        <div className="space-y-6">
          {grouped.map(([projectPath, exps]) => (
            <div key={projectPath}>
              <div className="flex items-center gap-2 mb-2 pb-1 border-b border-gray-100">
                <Folder size={14} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-500">
                  {shortProjectPath(projectPath === "__unknown__" ? undefined : projectPath)}
                </span>
                <span className="text-xs text-gray-300">
                  ({exps.length})
                </span>
              </div>
              <div className="space-y-2">
                {exps.map((exp) => (
                  <Link
                    key={exp.id}
                    to={`/experiences/${exp.id}`}
                    className="block p-4 rounded-lg border border-gray-200 bg-white hover:border-blue-300 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{exp.title}</span>
                      <ScopeBadge scope={exp.scope} />
                      <StatusBadge status={exp.status} />
                      <ConfidenceBadge confidence={exp.confidence} />
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      {truncate(exp.recommendation, 120)}
                    </p>
                    <div className="flex gap-1">
                      {exp.triggers.slice(0, 5).map((t) => (
                        <TriggerTag key={t} trigger={t} />
                      ))}
                      {exp.triggers.length > 5 && (
                        <span className="text-xs text-gray-400">
                          +{exp.triggers.length - 5}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">未找到经验。</p>
      )}
    </div>
  );
}
