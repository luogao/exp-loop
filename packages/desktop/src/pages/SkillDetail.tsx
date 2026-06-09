import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import { useSkill, useExportSkill } from "../hooks/useApiQuery";
import { ScopeBadge, StatusBadge, TriggerTag } from "../components/Badges";
import { formatDate } from "../lib/utils";
import { useState } from "react";

export function SkillDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: skill, isLoading } = useSkill(id!);
  const exportSkill = useExportSkill();
  const [exportMsg, setExportMsg] = useState("");

  if (isLoading) return <div className="p-6 text-sm text-gray-400">加载中...</div>;
  if (!skill) return <div className="p-6 text-sm text-gray-400">未找到该技能。</div>;

  const handleExport = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, title: "导出技能到..." });
      if (!dir) return;
      const result = await exportSkill.mutateAsync({
        skillId: skill.id,
        targetDir: dir as string,
      });
      setExportMsg(`已导出到 ${result.path}`);
    } catch (e: any) {
      setExportMsg(`错误：${e.message || e}`);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <Link
        to="/skills"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft size={14} />
        返回技能列表
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">{skill.name}</h1>
        <ScopeBadge scope={skill.scope} />
        <StatusBadge status={skill.status} />
      </div>
      <p className="text-sm text-gray-500 mb-2">{skill.description}</p>
      <div className="flex gap-1 mb-4">
        {skill.triggers.map((t) => (
          <TriggerTag key={t} trigger={t} />
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={handleExport}
          disabled={exportSkill.isPending}
          className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <Download size={14} />
          导出 SKILL.md
        </button>
      </div>

      {exportMsg && (
        <p className="text-xs text-emerald-600 mb-4">{exportMsg}</p>
      )}

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
          {skill.content}
        </pre>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200 text-xs text-gray-400 space-y-1">
        <p>ID：{skill.id}</p>
        <p>版本：{skill.version}</p>
        <p>领域：{skill.domain || "—"} / 类型：{skill.taskType || "—"}</p>
        <p>创建：{formatDate(skill.createdAt)} / 更新：{formatDate(skill.updatedAt)}</p>
      </div>
    </div>
  );
}
