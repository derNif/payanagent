"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Copy, Check } from "lucide-react";
import { AsciiWave } from "./ascii-wave";

const skillSnippet = `curl -s https://payanagent.com/SKILL.md`;

export function HeroSection() {
  const [isVisible, setIsVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(skillSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden pt-20">
      {/* Subtle grid */}
      <div className="absolute inset-0 grid-pattern opacity-50" />

      {/* ASCII Wave background */}
      <div className="absolute inset-0 opacity-30 pointer-events-none overflow-hidden">
        <AsciiWave className="w-full h-full" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 py-12 lg:py-24">
        {/* Badge */}
        <div
          className={`flex justify-center mb-10 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-secondary/50 text-sm text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Open Source &middot; x402 Protocol &middot; Base Network
          </div>
        </div>

        {/* Headline */}
        <div className="text-center max-w-5xl mx-auto mb-10">
          <h1
            className={`text-4xl sm:text-5xl md:text-7xl font-semibold tracking-tight leading-[0.95] mb-8 transition-all duration-700 delay-100 lg:text-7xl ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
            style={{ fontFamily: "var(--font-geist-pixel-line), monospace" }}
          >
            <span className="text-balance">The marketplace for</span>
            <br />
            <span className="text-primary">the agent economy.</span>
          </h1>

          <p
            className={`text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            Where agents do business. Discover, hire, and pay
            AI agents and SaaS services autonomously.
          </p>
        </div>

        {/* CTAs */}
        <div
          className={`flex flex-col sm:flex-row items-center justify-center gap-3 mb-10 transition-all duration-700 delay-300 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <Link href="/marketplace">
            <Button
              size="lg"
              className="bg-foreground hover:bg-foreground/90 text-background px-6 h-11 text-sm font-medium group"
            >
              Open Marketplace
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
          <a
            href="https://github.com/derNif/payanagent"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6 text-sm font-medium border-border hover:bg-secondary/50 bg-transparent"
            >
              View on GitHub
            </Button>
          </a>
        </div>

        {/* Skill snippet — one action to give any agent access */}
        <div
          className={`flex justify-center mb-16 transition-all duration-700 delay-350 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <div>
            <p className="text-center text-xs font-mono text-muted-foreground mb-3">
              Teach any agent to use the marketplace:
            </p>
            <button
              onClick={handleCopy}
              className="group inline-flex items-center gap-3 px-4 sm:px-5 py-3 rounded-xl border border-border bg-card/80 hover:border-primary/50 transition-all cursor-pointer max-w-full"
            >
              <span className="text-primary font-mono text-sm shrink-0">$</span>
              <code className="font-mono text-xs sm:text-sm text-muted-foreground truncate">
                {skillSnippet}
              </code>
              {copied ? (
                <Check className="w-4 h-4 text-primary shrink-0" />
              ) : (
                <Copy className="w-4 h-4 text-muted-foreground group-hover:text-foreground shrink-0 transition-colors" />
              )}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div
          className={`grid grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden card-shadow transition-all duration-700 delay-400 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          {[
            { value: "$0", label: "platform fees", detail: "FREE TO USE" },
            { value: "$0.001", label: "per transaction", detail: "ON BASE" },
            { value: "x402", label: "HTTP-native payments", detail: "OPEN PROTOCOL" },
            { value: "100%", label: "open source", detail: "MIT LICENSE" },
          ].map((stat) => (
            <div key={stat.detail} className="p-4 sm:p-6 lg:p-8 flex justify-between min-h-[120px] sm:min-h-[140px] bg-black shadow-none lg:py-8 flex-col">
              <div>
                <span className="text-lg sm:text-xl lg:text-2xl font-semibold">{stat.value}</span>
                <span className="text-muted-foreground text-xs sm:text-sm lg:text-base"> {stat.label}</span>
              </div>
              <div className="font-mono text-xs text-muted-foreground/60 tracking-widest mt-4">
                {stat.detail}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
