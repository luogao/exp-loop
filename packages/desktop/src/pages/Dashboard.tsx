import { useState } from "react";
import { Play, Square, Folder, Lightbulb, BookOpen, Loader2, Eye } from "lucide-react";
import { ObserveProgress } from "../components/ObserveProgress";
import { ProjectExpModal } from "../components/ProjectExpModal";
import { useStats, useProjectStats, useLearn } from "../hooks/useApiQuery";
import { useObserveProgress } from "../hooks/useObserveProgress";
import { formatDate } from "../lib/utils";
import { cn } from "../lib/utils";

export function Dashboard() {
  const { data: stats, isLoading } = useStats();
  const { data: projectStats } = useProjectStats();
  const [expModal, setExpModal] = useState<{ path: string; name: string } | null>(null);
  const learn = useLearn();
  const progress = useObserveProgress();

  const handleLearn = () => {
    progress.start();
    learn.mutate(undefined, {
      onSettled: () => progress.stop(),
    });
  };

  const handleLearnProject = (projectPath: string) => {
    progress.start();
    learn.mutate({ projectPath }, {
      onSettled: () => progress.stop(),
    });
  };

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">仪表盘</h1>
          {learn.isPending && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-medium animate-pulse">
              <Loader2 size={12} className="animate-spin" />
              学习中...
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {learn.isPending ? (
            <button
              onClick={() => progress.stop()}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
            >
              <Square size={16} />
              停止
            </button>
          ) : (
            <button
              onClick={handleLearn}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Play size={16} />
              开始学习
            </button>
          )}
        </div>
      </div>

      {/* 全局统计条 */}
      {!isLoading && stats && (
        <div className="flex gap-6 mb-6 p-4 rounded-lg bg-white border border-gray-200">
          <StatItem label="会话" value={stats.episodes.total} />
          <StatItem label="经验" value={stats.experiences.active} highlight />
          <StatItem label="模式" value={stats.patterns.total} />
          <StatItem label="技能" value={stats.skills.total} />
        </div>
      )}

      {/* 学习进度 + 日志 */}
      {(learn.isPending || progress.sessions.length > 0 || progress.logs.length > 0) && (
        <div className="mb-6">
          <ObserveProgress
            sessions={progress.sessions}
            active={progress.active}
            llmStatus={progress.llmStatus}
            logs={progress.logs}
          />
        </div>
      )}

      {learn.data && !learn.isPending && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          学习完成：处理了 {learn.data.observe.sessionsProcessed} 个会话，提取了{" "}
          {learn.data.observe.experiencesExtracted} 条经验，同步了{" "}
          {learn.data.sync.filter((s) => s.action !== "unchanged").length} 个文件。
        </div>
      )}

      {/* 项目列表 */}
      <div>
        <h2 className="text-sm font-medium text-gray-700 mb-3">项目概览</h2>
        {projectStats && projectStats.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {projectStats.map((project) => (
              <div
                key={project.projectPath}
                className="flex items-center gap-4 p-4 rounded-lg border border-gray-200 bg-white hover:border-gray-300 transition-colors"
              >
                <Folder size={20} className="text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {project.projectName}
                    </span>
                    {project.lastSessionAt && (
                      <span className="text-xs text-gray-300">
                        最近会话 {formatDate(project.lastSessionAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <BookOpen size={11} />
                      {project.episodes} 会话
                      <span className="text-emerald-500">({project.successCount} 成功)</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Lightbulb size={11} />
                      {project.activeExperiences} 经验
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {project.activeExperiences > 0 && (
                    <button
                      onClick={() => setExpModal({ path: project.projectPath, name: project.projectName })}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      <Eye size={12} />
                      经验
                    </button>
                  )}
                  <button
                    onClick={() => handleLearnProject(project.projectPath)}
                    disabled={learn.isPending}
                    className={cn(
                      "px-3 py-1.5 text-xs rounded border transition-colors",
                      learn.isPending
                        ? "opacity-40 cursor-not-allowed border-gray-200 text-gray-400"
                        : "border-blue-200 text-blue-600 hover:bg-blue-50",
                    )}
                  >
                    学习
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : isLoading ? (
          <p className="text-sm text-gray-400">加载中...</p>
        ) : (
          <p className="text-sm text-gray-400">暂无项目数据。点击「开始学习」来采集。</p>
        )}
      </div>

      {expModal && (
        <ProjectExpModal
          projectPath={expModal.path}
          projectName={expModal.name}
          onClose={() => setExpModal(null)}
        />
      )}
    </div>
  );
}

function StatItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className={cn(
          "text-lg font-semibold",
          highlight ? "text-blue-600" : "text-gray-900",
        )}
      >
        {value}
      </span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}
