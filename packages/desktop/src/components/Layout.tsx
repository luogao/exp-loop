import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Lightbulb,
  GitBranch,
  Wrench,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { useUIStore } from "../stores/uiStore";
import { cn } from "../lib/utils";
import { ServerLogPanel } from "./ServerLogPanel";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "仪表盘" },
  { to: "/experiences", icon: Lightbulb, label: "经验" },
  { to: "/patterns", icon: GitBranch, label: "模式" },
  { to: "/skills", icon: Wrench, label: "技能" },
  { to: "/settings", icon: Settings, label: "设置" },
];

export function Layout() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      <aside
        className={cn(
          "flex flex-col border-r border-gray-200 bg-white transition-all duration-200",
          sidebarCollapsed ? "w-16" : "w-56",
        )}
      >
        <div className="flex items-center gap-2 px-4 py-4 border-b border-gray-200">
          {!sidebarCollapsed && (
            <span className="font-semibold text-sm tracking-tight">
              exp-loop
            </span>
          )}
          <button
            onClick={toggleSidebar}
            className="ml-auto p-1 rounded hover:bg-gray-100"
          >
            {sidebarCollapsed ? (
              <PanelLeft size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>
        <nav className="flex-1 py-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                )
              }
            >
              <Icon size={18} />
              {!sidebarCollapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
        <ServerLogPanel />
      </main>
    </div>
  );
}
