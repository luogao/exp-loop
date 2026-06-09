import { usePatterns } from "../hooks/useApiQuery";

const promotionLabels: Record<string, string> = {
  none: "无",
  candidate_skill: "候选技能",
  existing_skill_patch: "技能补丁",
};

export function Patterns() {
  const { data: patterns, isLoading } = usePatterns();

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-semibold mb-4">模式</h1>

      {isLoading ? (
        <p className="text-sm text-gray-400">加载中...</p>
      ) : patterns && patterns.length > 0 ? (
        <div className="space-y-3">
          {patterns.map((pattern) => (
            <div
              key={pattern.id}
              className="p-4 rounded-lg border border-gray-200 bg-white"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium font-mono">
                  {pattern.signature}
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                  {promotionLabels[pattern.promotion] ?? pattern.promotion}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-3 text-xs text-gray-500">
                <div>
                  <span className="text-gray-400">成功率：</span>
                  <span className="font-medium text-gray-700">
                    {Math.round(pattern.successRate * 100)}%
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">支持度：</span>
                  <span className="font-medium text-gray-700">
                    {pattern.support}
                  </span>
                </div>
                <div>
                  <span className="text-gray-400">置信度：</span>
                  <span className="font-medium text-gray-700">
                    {Math.round(pattern.confidence * 100)}%
                  </span>
                </div>
              </div>

              {pattern.commonSteps.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs text-gray-400 mb-1">常见步骤：</p>
                  <div className="flex flex-wrap gap-1">
                    {pattern.commonSteps.map((step, i) => (
                      <span
                        key={i}
                        className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs"
                      >
                        {step}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-gray-400 mt-2">
                <span>匹配会话：{pattern.matchedEpisodeIds.length} 个</span>
                {pattern.domain && (
                  <span className="ml-3">领域：{pattern.domain}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">
          暂无模式。模式会在多个相似会话被处理后自动提取。
        </p>
      )}
    </div>
  );
}
