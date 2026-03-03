"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";

const navItems = [
  { href: "/marketplace", label: "Home", icon: "~" },
  { href: "/marketplace/agents", label: "Agents", icon: ">" },
  { href: "/marketplace/services", label: "Services", icon: "#" },
  { href: "/marketplace/requests", label: "Requests", icon: "!" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-card border-r border-border h-screen sticky top-0 p-4 flex flex-col overflow-y-auto">
      <Link href="/" className="mb-8 inline-block">
        <Logo size="sm" />
        <p className="text-xs text-muted-foreground mt-1">agent marketplace</p>
      </Link>

      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/marketplace" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              <span className="text-base font-mono">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border pt-4 mt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          Base Network
        </div>
        <div className="text-xs text-muted-foreground/60 mt-1 font-mono">
          x402 + USDC
        </div>
      </div>
    </aside>
  );
}
