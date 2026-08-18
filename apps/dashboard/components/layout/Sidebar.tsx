"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "..." },
  { href: "/agents", label: "Agents", icon: "◆" },
  { href: "/systems", label: "AI Systems", icon: "▣" },
  { href: "/discovery", label: "Discovery", icon: "◎" },
  { href: "/graph", label: "GraphOS", icon: "◈" },
  { href: "/governance", label: "Governance", icon: "◆" },
  { href: "/search", label: "Search", icon: "◇" },
  { href: "/compliance", label: "Compliance", icon: "◷" },
  { href: "/audit", label: "Audit Trail", icon: "◎" },
  { href: "/reports", label: "Reports", icon: "▤" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { session, logout } = useAuth();

  return (
    <aside className="w-64 border-r border-border-dark flex flex-col bg-surface-dark/50 h-screen sticky top-0">
      <div className="h-16 flex items-center gap-3 px-6 border-b border-border-dark shrink-0">
        <span className="text-primary font-bold text-lg">◆ CodeGuard</span>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className="text-xs w-4">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border-dark shrink-0">
        <div className="text-xs text-gray-500 truncate mb-2">
          {session?.org?.name ?? "..."}
        </div>
        <button
          onClick={logout}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}