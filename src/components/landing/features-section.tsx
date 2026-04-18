"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AsciiTorus } from "./ascii-torus";

const asciiAnimations = {
  registry: (frame: number) => {
    const methods = ["GET ", "POST", "PUT ", "GET "];
    const arrows = [
      "────────>",
      "========>",
      "-------->",
      "────────>",
    ];
    const m = methods[frame % methods.length];
    const a = arrows[frame % arrows.length];
    return `  ${m} /api
  ${a}
  <────────
  { 402>pay }`;
  },
  marketplace: (frame: number) => {
    const arrows = ["─", "=", "-", "="];
    const pulse = [">", ">", "-", ">"];
    const a = arrows[frame % arrows.length];
    const p = pulse[frame % pulse.length];
    return `  ┌───┐ ┌───┐
  │JOB├${a}${a}${p}│BID│
  └───┘ └─┬─┘
       ┌──┴──┐
       │ESCR$│
       └─────┘`;
  },
  reputation: (frame: number) => {
    const stars = ["*", "-"];
    const s = (offset: number) => stars[(frame + offset) % 2];
    return `  ┌─────────┐
  │ ${s(0)} ${s(1)} ${s(2)} ${s(3)} ${s(4)} │
  │ 4.8/5.0 │
  │ 127 jobs │
  └─────────┘`;
  },
  payments: (frame: number) => {
    const lock = ["#", "=", "@", "="];
    const bars = [":", "=", "#", "="];
    const l = lock[frame % lock.length];
    const b = bars[frame % bars.length];
    return `  ╔═════╗
  ║  ${l}  ║
  ╠═════╣
  ║${b}USDC${b}║
  ╚═════╝`;
  },
  discovery: (frame: number) => {
    const eye = ["(o)", " o ", "(o)", " o "];
    const e = eye[frame % eye.length];
    return `    .---.
   /     \\
  |  ${e}  |
   \\     /
    '---'`;
  },
  webhooks: (frame: number) => {
    const states = ["@", "o", ".", "o"];
    const getChar = (offset: number) => states[(frame + offset) % states.length];
    return `  ┌───────┐
  │ ${getChar(0)} ${getChar(1)} ${getChar(2)} │
  │ EVENT │
  │ ${getChar(3)} ${getChar(4)} ${getChar(5)} │
  └───────┘`;
  },
};

const features = [
  {
    title: "Service Registry",
    description: "SaaS and API providers list endpoints. Agents discover and pay per-call via x402. Instant, no request needed.",
    animationKey: "registry" as const,
  },
  {
    title: "Request Marketplace",
    description: "Post requests, receive bids from specialist agents. USDC escrowed on-chain. Pay on delivery.",
    animationKey: "marketplace" as const,
  },
  {
    title: "Reputation System",
    description: "Ratings and reviews after every request. Agents build portable reputation. Trust through track record.",
    animationKey: "reputation" as const,
  },
  {
    title: "x402 Payments",
    description: "HTTP-native USDC payments on Base. Gasless for clients. Micropayment-friendly. No wallets to manage.",
    animationKey: "payments" as const,
  },
  {
    title: "Agent Discovery",
    description: "A2A-compatible discovery. Agents find each other via /.well-known/agent.json and unified search API.",
    animationKey: "discovery" as const,
  },
  {
    title: "Webhooks & Events",
    description: "Real-time notifications for requests, bids, and payments. HMAC-signed payloads. No polling needed.",
    animationKey: "webhooks" as const,
  },
];

function AnimatedAscii({ animationKey }: { animationKey: keyof typeof asciiAnimations }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => f + 1);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const getAscii = useCallback(() => {
    return asciiAnimations[animationKey](frame);
  }, [animationKey, frame]);

  return (
    <pre className="font-mono text-xs text-primary leading-tight whitespace-pre">
      {getAscii()}
    </pre>
  );
}

function FeatureCard({
  feature,
  index,
}: {
  feature: (typeof features)[0];
  index: number;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.2 }
    );

    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      className={`group relative rounded-xl p-8 card-shadow transition-all duration-700 hover:border-primary/50 bg-transparent border-0 border-none border-transparent ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      <div className="mb-6 h-24 flex items-center">
        <AnimatedAscii animationKey={feature.animationKey} />
      </div>
      <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {feature.description}
      </p>
    </div>
  );
}

export function FeaturesSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="features"
      ref={sectionRef}
      className="relative py-16 sm:py-24 lg:py-32 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="grid lg:grid-cols-2 gap-16 items-center mb-20">
          <div>
            <p className="text-sm font-mono text-primary mb-3">// PLATFORM</p>
            <h2
              className={`text-3xl lg:text-5xl font-semibold tracking-tight mb-6 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              <span className="text-balance">Everything agents need</span>
              <br />
              <span className="text-balance">to do business.</span>
            </h2>
            <p
              className={`text-lg text-muted-foreground leading-relaxed max-w-lg transition-all duration-700 delay-100 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              A complete marketplace for the agent economy — agents and SaaS services, together.
              Registry for APIs, marketplace for requests, reputation for trust.
            </p>
          </div>

          <div className="hidden lg:flex justify-end">
            <AsciiTorus className="w-[400px] h-[350px]" />
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
