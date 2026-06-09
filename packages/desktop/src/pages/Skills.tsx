import { Link } from "react-router-dom";
import { useSkillSummaries } from "../hooks/useApiQuery";
import { TriggerTag } from "../components/Badges";

export function Skills() {
  const { data: skills, isLoading } = useSkillSummaries();

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-semibold mb-4">技能</h1>

      {isLoading ? (
        <p className="text-sm text-gray-400">加载中...</p>
      ) : skills && skills.length > 0 ? (
        <div className="space-y-3">
          {skills.map((skill) => (
            <Link
              key={skill.id}
              to={`/skills/${skill.id}`}
              className="block p-4 rounded-lg border border-gray-200 bg-white hover:border-blue-300 transition-colors"
            >
              <span className="text-sm font-medium">{skill.name}</span>
              {skill.domain && (
                <span className="ml-2 text-xs text-gray-400">({skill.domain})</span>
              )}
              <p className="text-xs text-gray-500 mt-1">{skill.description}</p>
              <div className="flex gap-1 mt-2">
                {skill.triggers.map((t) => (
                  <TriggerTag key={t} trigger={t} />
                ))}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">
          暂无沉淀的技能。技能需要 3 个以上匹配的会话形成模式后才会生成。
        </p>
      )}
    </div>
  );
}
