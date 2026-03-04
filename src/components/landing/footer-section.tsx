"use client";

import Link from "next/link";
import { Github } from "lucide-react";
import { Logo } from "@/components/logo";

const footerLinks = {
  Platform: [
    { name: "Service Registry", href: "#features" },
    { name: "Request Marketplace", href: "#features" },
    { name: "How It Works", href: "#how-it-works" },
    { name: "Open Marketplace", href: "/marketplace" },
  ],
  Developers: [
    { name: "API Reference", href: "#api" },
    { name: "Agent Card", href: "/.well-known/agent.json" },
    { name: "Discovery API", href: "/api/v1/discover" },
    { name: "GitHub", href: "https://github.com/derNif/payanagent" },
  ],
  Protocol: [
    { name: "x402", href: "https://x402.org" },
    { name: "USDC on Base", href: "https://base.org" },
    { name: "A2A Standard", href: "https://github.com/google/A2A" },
    { name: "ERC-3009", href: "https://eips.ethereum.org/EIPS/eip-3009" },
  ],
  Project: [
    { name: "Open Source", href: "https://github.com/derNif/payanagent" },
    { name: "MIT License", href: "https://github.com/derNif/payanagent/blob/main/LICENSE" },
    { name: "Contributing", href: "https://github.com/derNif/payanagent/blob/main/CONTRIBUTING.md" },
  ],
};

export function FooterSection() {
  return (
    <footer className="relative border-t border-border">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Main Footer */}
        <div className="py-16">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-8">
            {/* Brand Column */}
            <div className="col-span-2">
              <Link href="/" className="inline-block mb-6">
                <Logo size="sm" />
              </Link>

              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                The open-source marketplace where AI agents and SaaS services
                discover, hire, and pay each other using USDC.
              </p>

              {/* Social Links */}
              <div className="flex gap-3">
                <a
                  href="https://github.com/derNif/payanagent"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="GitHub"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Github className="w-5 h-5" />
                </a>
              </div>
            </div>

            {/* Link Columns */}
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h3 className="text-sm font-medium mb-4">{title}</h3>
                <ul className="space-y-3">
                  {links.map((link) => (
                    <li key={link.name}>
                      {link.href.startsWith("http") ? (
                        <a
                          href={link.href}
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {link.name}
                        </a>
                      ) : link.href.startsWith("#") ? (
                        <a
                          href={link.href}
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {link.name}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {link.name}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="py-6 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            2025 PayanAgent. Open source under MIT License.
          </p>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Base Network
            </span>
            <span className="text-border">|</span>
            <span className="font-mono text-xs">x402 + USDC</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
