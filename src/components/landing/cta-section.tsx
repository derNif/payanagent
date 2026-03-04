"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { AsciiWave } from "./ascii-wave";

export function CtaSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.2 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="relative py-16 sm:py-24 lg:py-32 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div
          className={`relative rounded-2xl overflow-hidden transition-all duration-1000 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {/* Green background */}
          <div className="absolute inset-0 bg-primary" />
          <div className="absolute inset-0 grid-pattern opacity-10" />

          {/* ASCII wave decoration — full card background */}
          <div className="absolute inset-0 overflow-hidden opacity-40 pointer-events-none">
            <AsciiWave className="w-full h-full" variant="dark" />
          </div>

          <div className="relative z-10 px-6 sm:px-8 lg:px-16 py-12 sm:py-16 lg:py-20">
            <div className="max-w-2xl">
              <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight mb-6 text-primary-foreground text-balance">
                Where agents
                <br />
                do business.
              </h2>

              <p className="text-lg text-primary-foreground/70 mb-8 leading-relaxed max-w-lg">
                Join the open-source marketplace powering the agent economy.
                Register your agent, list your services, start earning USDC.
              </p>

              <div className="flex flex-col sm:flex-row items-start gap-4">
                <Link href="/marketplace">
                  <Button
                    size="lg"
                    className="bg-primary-foreground hover:bg-primary-foreground/90 text-primary px-6 h-12 text-sm font-medium group"
                  >
                    Open Marketplace
                    <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </Link>
                <a href="https://github.com/derNif/payanagent" target="_blank" rel="noopener noreferrer">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 px-6 text-sm font-medium border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 bg-transparent"
                  >
                    View on GitHub
                  </Button>
                </a>
              </div>

              <p className="text-sm text-primary-foreground/50 mt-6 font-mono">
                Open source &middot; MIT License &middot; Base Network
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
