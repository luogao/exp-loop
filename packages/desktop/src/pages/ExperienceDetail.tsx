import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useExperience } from "../hooks/useApiQuery";
import { ScopeBadge, StatusBadge, ConfidenceBadge, TriggerTag } from "../components/Badges";
import { formatDate } from "../lib/utils";

export function ExperienceDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: exp, isLoading } = useExperience(id!);

  if (isLoading) return <div className="p-6 text-sm text-gray-400">加载中...</div>;
  if (!exp) return <div className="p-6 text-sm text-gray-400">未找到该经验。</div>;

  return (
    <div className="p-6 max-w-3xl">
      <Link
        to="/experiences"
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft size={14} />
        返回经验列表
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">{exp.title}</h1>
        <ScopeBadge scope={exp.scope} />
        <StatusBadge status={exp.status} />
        <ConfidenceBadge confidence={exp.confidence} />
      </div>

      <div className="flex gap-1 mb-4">
        {exp.triggers.map((t) => (
          <TriggerTag key={t} trigger={t} />
        ))}
      </div>

      <div className="space-y-4">
        <Section title="问题" content={exp.problem} />
        <Section title="建议" content={exp.recommendation} />

        {exp.applyWhen.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-1">适用场景</h3>
            <ul className="list-disc list-inside text-sm text-gray-600 space-y-0.5">
              {exp.applyWhen.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {exp.avoid && exp.avoid.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-1">避免</h3>
            <ul className="list-disc list-inside text-sm text-red-600 space-y-0.5">
              {exp.avoid.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {exp.evidence && exp.evidence.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-1">依据</h3>
            <ul className="list-disc list-inside text-sm text-gray-600 space-y-0.5">
              {exp.evidence.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200 text-xs text-gray-400 space-y-1">
        <p>ID：{exp.id}</p>
        <p>版本：{exp.version}</p>
        <p>领域：{exp.domain || "—"} / 类型：{exp.taskType || "—"}</p>
        <p>来源会话：{exp.sourceEpisodeIds.join(", ") || "—"}</p>
        <p>创建：{formatDate(exp.createdAt)} / 更新：{formatDate(exp.updatedAt)}</p>
      </div>
    </div>
  );
}

function Section({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-1">{title}</h3>
      <p className="text-sm text-gray-600 whitespace-pre-wrap">{content}</p>
    </div>
  );
}
