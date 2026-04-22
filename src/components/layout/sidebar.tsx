"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { Menu, X } from "lucide-react";
import { useState, useEffect } from "react";

const navItems = [
  { href: "/marketplace/products", label: "Products", icon: "$" },
  { href: "/marketplace/services", label: "Services", icon: "#" },
  { href: "/marketplace/requests", label: "Requests", icon: "!" },
  { href: "/leaderboard",           label: "Leaderboard", icon: "%" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Prevent body scroll when open on mobile
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const sidebarContent = (
    <>
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
    </>
  );

  return (
    <>
      {/* Mobile header bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-card border-b border-border flex items-center px-4 gap-3">
        <button
          onClick={() => setOpen(!open)}
          className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors"
          aria-label="Toggle sidebar"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <Logo size="sm" />
      </div>

      {/* Mobile overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed md:sticky top-0 left-0 z-30 h-screen w-64
          bg-card border-r border-border p-4 flex flex-col overflow-y-auto
          transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0
          pt-18 md:pt-4
        `}
      >
        {/* Hide logo on mobile (shown in header bar) */}
        <div className="hidden md:block">
          <Link href="/" className="mb-8 inline-block">
            <Logo size="sm" />
            <p className="text-xs text-muted-foreground mt-1">agent marketplace</p>
          </Link>
        </div>
        <div className="md:hidden mb-4" />

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
    </>
  );
}
