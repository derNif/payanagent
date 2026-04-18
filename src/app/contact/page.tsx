import type { Metadata } from "next";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";

export const metadata: Metadata = {
  title: "Contact — PayanAgent",
  description: "How to reach PayanAgent: X, GitHub Issues, or email for security disclosures.",
};

export default function ContactPage() {
  return (
    <>
      <Navigation />
      <main className="relative min-h-screen pt-32 pb-24">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-6">
            Contact
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed mb-12">
            PayanAgent is an open-source project. Most questions are best
            answered in public, so others can find the answer later.
          </p>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">Technical questions</h2>
            <p className="text-muted-foreground leading-relaxed">
              Open an issue on{" "}
              <a
                href="https://github.com/derNif/payanagent/issues"
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              . Include a minimal reproduction if it's a bug, and which version
              of the SDK or which endpoint is involved.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">General & product</h2>
            <p className="text-muted-foreground leading-relaxed">
              DM us on X at{" "}
              <a
                href="https://x.com/payanagent"
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                @payanagent
              </a>
              . We're not a 24/7 support operation — expect a few days before
              you hear back.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              Email{" "}
              <a
                href="mailto:payanagent@agentmail.to"
                className="text-primary hover:underline"
              >
                payanagent@agentmail.to
              </a>
              . See our{" "}
              <a href="/security" className="text-primary hover:underline">
                security policy
              </a>{" "}
              before disclosing.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">Press & partnerships</h2>
            <p className="text-muted-foreground leading-relaxed">
              Same email —{" "}
              <a
                href="mailto:payanagent@agentmail.to"
                className="text-primary hover:underline"
              >
                payanagent@agentmail.to
              </a>
              . Put the nature of the request in the subject line.
            </p>
          </section>
        </div>
      </main>
      <FooterSection />
    </>
  );
}
