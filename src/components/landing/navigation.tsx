"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Menu, X, ArrowRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { GitHubButton } from "./github-button";

const navLinks = [
  { name: "Platform", href: "#features" },
  { name: "How It Works", href: "#how-it-works" },
  { name: "For Agents", href: "#for-agents" },
  { name: "For SaaS", href: "#for-saas" },
  { name: "API", href: "#api" },
];

export function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        isScrolled || isMobileMenuOpen
          ? "bg-background/80 backdrop-blur-xl border-b border-border/50"
          : "bg-transparent"
      }`}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-18">
          <Link href="/" className="group shrink-0">
            <Logo />
          </Link>

          {/* Desktop Navigation — centered pill */}
          <div className="hidden lg:flex items-center absolute left-1/2 -translate-x-1/2">
            <div
              className={`flex items-center gap-0.5 rounded-full px-1.5 py-1 transition-all duration-500 ${
                isScrolled
                  ? "border border-border/60 bg-card/60 backdrop-blur-md"
                  : "border border-transparent"
              }`}
            >
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className="px-3.5 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 rounded-full hover:bg-secondary/60"
                >
                  {link.name}
                </a>
              ))}
            </div>
          </div>

          {/* Desktop CTA */}
          <div className="hidden lg:flex items-center gap-1 shrink-0">
            <Link
              href="/docs"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-lg hover:bg-secondary/50"
            >
              Docs
            </Link>
            <GitHubButton />
            <Link href="/marketplace" className="ml-2">
              <Button
                size="sm"
                className="bg-foreground hover:bg-foreground/90 text-background group"
              >
                Marketplace
                <ArrowRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-secondary/50 transition-colors"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>

        {/* Mobile Menu */}
        <div
          className={`lg:hidden overflow-hidden transition-all duration-300 ${
            isMobileMenuOpen ? "max-h-[560px] pb-6" : "max-h-0"
          }`}
        >
          <div className="flex flex-col gap-1 pt-4 border-t border-border/50">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className="px-4 py-3 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
              >
                {link.name}
              </a>
            ))}
            <div className="flex flex-col gap-2 pt-4 mt-2 border-t border-border/50">
              <Link href="/docs" onClick={() => setIsMobileMenuOpen(false)}>
                <Button variant="ghost" className="w-full justify-start text-muted-foreground">
                  Docs
                </Button>
              </Link>
              <a href="https://github.com/derNif/payanagent" target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" className="w-full justify-start text-muted-foreground">
                  GitHub
                </Button>
              </a>
              <Link href="/marketplace" onClick={() => setIsMobileMenuOpen(false)}>
                <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                  Marketplace
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
