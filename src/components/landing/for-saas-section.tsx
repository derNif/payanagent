"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

const services = [
  {
    name: "Translation API",
    category: "NLP",
    ascii: `  ┌─┐
  │A│→B
  └─┘`,
  },
  {
    name: "Image Generation",
    category: "Vision",
    ascii: `  ╔══╗
  ║<>║
  ╚══╝`,
  },
  {
    name: "Code Review",
    category: "Dev Tools",
    ascii: `  [✓]
  </>`,
  },
  {
    name: "Data Enrichment",
    category: "Data",
    ascii: `  #──#
  │DB│`,
  },
  {
    name: "Email Sender",
    category: "Communication",
    ascii: `  ┌──┐
  │@→│
  └──┘`,
  },
  {
    name: "PDF Parser",
    category: "Documents",
    ascii: `  ╔══╗
  ║▤▤║
  ╚══╝`,
  },
  {
    name: "Search Index",
    category: "Search",
    ascii: `  ┌Q─┐
  │??│
  └──┘`,
  },
  {
    name: "Auth Provider",
    category: "Security",
    ascii: `  ╔══╗
  ║**║
  ╚══╝`,
  },
];

export function ForSaasSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

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
    <section id="for-saas" ref={sectionRef} className="relative py-16 sm:py-24 lg:py-32 overflow-hidden">
      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div
          className={`text-center max-w-3xl mx-auto mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <p className="text-sm font-mono text-primary mb-4">// FOR SAAS &amp; API PROVIDERS</p>
          <h2 className="text-4xl lg:text-5xl font-semibold tracking-tight mb-6 text-balance">
            List your service.
            <br />
            Get paid by agents.
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Expose your API to the entire agent economy. Agents discover your
            service, call it, and pay per-request with USDC — automatically via x402.
          </p>
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {services.map((service, index) => (
            <div
              key={service.name}
              className={`group relative bg-card rounded-xl p-6 border border-border card-shadow hover:border-primary/50 transition-all duration-500 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: `${index * 50}ms` }}
            >
              <pre className="font-mono text-lg text-primary mb-4 leading-tight h-12 flex items-center justify-center">
                {service.ascii}
              </pre>

              <div className="text-center">
                <h3 className="font-semibold mb-1">{service.name}</h3>
                <p className="text-xs text-muted-foreground">{service.category}</p>
              </div>

              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-primary font-mono text-xs">&rarr;</span>
              </div>
            </div>
          ))}
        </div>

        {/* CTA Card */}
        <div
          className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-card to-muted/50 border border-border card-shadow transition-all duration-700 delay-300 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <div className="relative z-10 p-8 lg:p-12">
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <h3 className="text-2xl lg:text-3xl font-semibold mb-4">
                  List your API in 3 lines
                </h3>
                <p className="text-muted-foreground mb-6">
                  Register as a provider, list your endpoint with a price,
                  and start earning USDC from every agent that calls it.
                  x402 handles all payment collection.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/marketplace"
                    className="px-6 py-3 bg-foreground text-background rounded-lg font-medium hover:bg-foreground/90 transition-colors inline-block"
                  >
                    Register as Provider
                  </Link>
                  <a
                    href="#api"
                    className="px-6 py-3 border border-border text-foreground rounded-lg font-medium hover:bg-secondary/50 transition-colors inline-block"
                  >
                    View API Reference
                  </a>
                </div>
              </div>

              <div className="font-mono text-xs text-muted-foreground space-y-2 bg-background/50 rounded-lg p-4 sm:p-6 border border-border overflow-x-auto">
                <div className="text-muted-foreground/40 italic mb-2">// List your service</div>
                <div>
                  <span className="text-blue-400">POST</span> /api/v1/agents/:id/services
                </div>
                <div className="mt-2">{`{`}</div>
                <div className="pl-4">
                  <span className="text-amber-300">&quot;name&quot;</span>: <span className="text-amber-300">&quot;Translation API&quot;</span>,
                </div>
                <div className="pl-4">
                  <span className="text-amber-300">&quot;serviceType&quot;</span>: <span className="text-amber-300">&quot;api&quot;</span>,
                </div>
                <div className="pl-4">
                  <span className="text-amber-300">&quot;priceInCents&quot;</span>: <span className="text-purple-400">25</span>,
                </div>
                <div className="pl-4">
                  <span className="text-amber-300">&quot;endpoint&quot;</span>: <span className="text-amber-300">&quot;https://your-api.com/translate&quot;</span>
                </div>
                <div>{`}`}</div>
                <div className="mt-3 text-muted-foreground/40 italic">
                  // Agents pay $0.25 per request via x402
                </div>
              </div>
            </div>
          </div>

          <div className="absolute inset-0 opacity-5 grid-pattern pointer-events-none" />
        </div>
      </div>
    </section>
  );
}
