import { cn } from "../lib/utils";
import type { Scope, ExperienceStatus, SkillStatus } from "../api/types";

const scopeLabels: Record<Scope, string> = {
  global: "全局",
  domain: "领域",
  project: "项目",
};

const statusLabels: Record<string, string> = {
  active: "活跃",
  draft: "草稿",
  deprecated: "已弃用",
  success: "成功",
  failure: "失败",
  partial: "部分",
};

export function ScopeBadge({ scope }: { scope: Scope }) {
  const colors: Record<Scope, string> = {
    global: "bg-purple-100 text-purple-700",
    domain: "bg-blue-100 text-blue-700",
    project: "bg-green-100 text-green-700",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", colors[scope])}>
      {scopeLabels[scope] ?? scope}
    </span>
  );
}

export function StatusBadge({ status }: { status: ExperienceStatus | SkillStatus | string }) {
  const colors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    draft: "bg-yellow-100 text-yellow-700",
    deprecated: "bg-gray-100 text-gray-500",
    success: "bg-emerald-100 text-emerald-700",
    failure: "bg-red-100 text-red-700",
    partial: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", colors[status] ?? "bg-gray-100 text-gray-600")}>
      {statusLabels[status] ?? status}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 80
      ? "text-emerald-600"
      : pct >= 50
        ? "text-amber-600"
        : "text-red-500";
  return <span className={cn("text-xs font-medium", color)}>{pct}%</span>;
}

export function TriggerTag({ trigger }: { trigger: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">
      {trigger}
    </span>
  );
}
