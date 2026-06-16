import { useState, useEffect, useCallback } from "react";
import { Play, Square, Folder, Lightbulb, BookOpen, Loader2, Eye, Radio } from "lucide-react";
import { ObserveProgress } from "../components/ObserveProgress";
import { ProjectExpModal } from "../components/ProjectExpModal";
import { useStats, useProjectStats, useLearn } from "../hooks/useApiQuery";
import { useObserveProgress } from "../hooks/useObserveProgress";
import { formatDate } from "../lib/utils";
import { cn } from "../lib/utils";
import { api } from "../api/client";
import type { SchedulerStatus } from "../api/types";

export function Dashboard() {
  const { data: stats, isLoading } = useStats();
  const { data: projectStats } = useProjectStats();
  const [expModal, setExpModal] = useState<{ path: string; name: string } | null>(null);
  const learn = useLearn();
  const progress = useObserveProgress();

  // ── Scheduler state ──
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [schedulerLoading, setSchedulerLoading] = useState(false);

  // Poll scheduler status on mount
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await api.scheduler.status();
        if (!cancelled) setSchedulerStatus(status);
      } catch {
        // ignore
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const isCollecting = schedulerStatus?.running === true;

  // Check if a project is in the selected list for collection
  const isProjectSelected = useCallback(
    (projectPath: string) => {
      const selected = schedulerStatus?.selectedProjects ?? [];
      // No projects selected means "collect all"
      if (selected.length === 0) return true;
      return selected.includes(projectPath);
    },
    [schedulerStatus?.selectedProjects],
  );

  const handleToggleCollect = useCallback(async () => {
    setSchedulerLoading(true);
    try {
      if (isCollecting) {
        const status = await api.scheduler.stop();
        setSchedulerStatus(status);
      } else {
        const status = await api.scheduler.start();
        setSchedulerStatus(status);
      }
    } catch (err) {
      console.error("Scheduler toggle failed:", err);
    } finally {
      setSchedulerLoading(false);
    }
  }, [isCollecting]);

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
          {isCollecting && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              <Radio size={12} className="animate-pulse" />
              自动收集中
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {/* Auto-collect toggle button */}
          <button
            onClick={handleToggleCollect}
            disabled={schedulerLoading}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              isCollecting
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-emerald-600 text-white hover:bg-emerald-700",
              schedulerLoading && "opacity-50 cursor-not-allowed"
            )}
          >
            {schedulerLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isCollecting ? (
              <Square size={16} />
            ) : (
              <Radio size={16} />
            )}
            {isCollecting ? "收集中..." : "开始收集"}
          </button>

          {/* One-shot learn button */}
          {!isCollecting && (
            <button
              onClick={handleLearn}
              disabled={learn.isPending}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                learn.isPending
                  ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              )}
            >
              {learn.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              手动学习
            </button>
          )}
        </div>
      </div>

      {/* Scheduler stats bar when collecting */}
      {isCollecting && (
        <div className="mb-4 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
          {/* Collecting projects */}
          <div className="flex items-center gap-2 mb-2 text-xs text-emerald-700">
            <Radio size={12} className="animate-pulse" />
            <span className="font-medium">正在收集</span>
            <span className="text-emerald-600">
              {schedulerStatus?.selectedProjects?.length > 0
                ? schedulerStatus.selectedProjects
                    .map((p) => {
                      const proj = projectStats?.find((ps) => ps.projectPath === p);
                      return proj?.projectName ?? p.split("/").slice(-2).join("/");
                    })
                    .join("、")
                : "全部项目"}
            </span>
          </div>
          {/* Stats */}
          {schedulerStatus?.state && (
            <div className="flex gap-6 text-xs text-emerald-700">
              <span>
                已处理 <strong>{schedulerStatus.state.stats.totalSessionsProcessed}</strong> 个会话
              </span>
              <span>
                提取 <strong>{schedulerStatus.state.stats.totalExperiencesExtracted}</strong> 条经验
              </span>
              <span>
                检查 <strong>{schedulerStatus.state.stats.totalChecksPerformed}</strong> 次
              </span>
              {schedulerStatus.state.stats.totalErrors > 0 && (
                <span className="text-red-600">
                  错误 <strong>{schedulerStatus.state.stats.totalErrors}</strong>
                </span>
              )}
            </div>
          )}
        </div>
      )}

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
                    {/* Collection status badge */}
                    {isCollecting && (
                      <span className={cn(
                        "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                        isProjectSelected(project.projectPath)
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-400",
                      )}>
                        <span className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          isProjectSelected(project.projectPath) ? "bg-emerald-500 animate-pulse" : "bg-gray-300",
                        )} />
                        {isProjectSelected(project.projectPath) ? "收集中" : "待收集"}
                      </span>
                    )}
                    {!isCollecting && isProjectSelected(project.projectPath) && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-500">
                        已选
                      </span>
                    )}
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
                  {!isCollecting && (
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
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : isLoading ? (
          <p className="text-sm text-gray-400">加载中...</p>
        ) : (
          <p className="text-sm text-gray-400">
            暂无项目数据。点击「开始收集」来自动采集，或点击「手动学习」进行一次性分析。
          </p>
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
