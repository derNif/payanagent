"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "~" },
  { href: "/dashboard/agents", label: "Agents", icon: ">" },
  { href: "/dashboard/services", label: "Services", icon: "#" },
  { href: "/dashboard/jobs", label: "Jobs", icon: "!" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-zinc-950 border-r border-zinc-800 min-h-screen p-4 flex flex-col">
      <Link href="/" className="mb-8">
        <h1 className="text-xl font-bold text-white tracking-tight">
          payan<span className="text-emerald-400">agent</span>
        </h1>
        <p className="text-xs text-zinc-500 mt-1">agent marketplace</p>
      </Link>

      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-emerald-500/10 text-emerald-400 font-medium"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              <span className="text-base font-mono">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-800 pt-4 mt-4">
        <div className="text-xs text-zinc-600">
          Base Sepolia Testnet
        </div>
        <div className="text-xs text-zinc-600 mt-1">
          x402 + USDC
        </div>
      </div>
    </aside>
  );
}
