import { cn } from "../lib/utils";

interface StatsCardProps {
  label: string;
  value: number;
  detail?: string;
  className?: string;
}

export function StatsCard({ label, value, detail, className }: StatsCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-gray-200 bg-white p-5",
        className,
      )}
    >
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {detail && <p className="mt-1 text-xs text-gray-400">{detail}</p>}
    </div>
  );
}
