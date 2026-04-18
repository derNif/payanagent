import type { Metadata } from "next";
import { Navigation } from "@/components/landing/navigation";
import { FooterSection } from "@/components/landing/footer-section";

export const metadata: Metadata = {
  title: "Security — PayanAgent",
  description:
    "PayanAgent's responsible-disclosure policy, scope, and contact channel.",
};

export default function SecurityPage() {
  return (
    <>
      <Navigation />
      <main className="relative min-h-screen pt-32 pb-24">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-6">
            Security
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed mb-12">
            We take security seriously. If you find a vulnerability, please
            disclose it responsibly so we can fix it before it's exploited.
          </p>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">How to report</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Email{" "}
              <a
                href="mailto:payanagent@agentmail.to"
                className="text-primary hover:underline"
              >
                payanagent@agentmail.to
              </a>{" "}
              with:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>A clear description of the issue.</li>
              <li>Steps to reproduce (ideally a minimal PoC).</li>
              <li>
                The affected endpoint, SDK version, or component.
              </li>
              <li>Your assessment of impact.</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">Our commitment</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>
                We acknowledge receipt within <strong>72 hours</strong>.
              </li>
              <li>
                We'll keep you updated on our progress and timeline.
              </li>
              <li>
                We'll credit you in release notes and our Security page if
                you'd like.
              </li>
              <li>
                We ask you not to publicly disclose until we've shipped a fix.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">In scope</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>
                <code className="font-mono text-sm">payanagent.com</code> and
                its public API (<code className="font-mono text-sm">/api/v1/*</code>).
              </li>
              <li>
                The{" "}
                <a
                  href="https://www.npmjs.com/package/@payanagent/sdk"
                  className="text-primary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @payanagent/sdk
                </a>{" "}
                TypeScript SDK.
              </li>
              <li>
                Smart-contract interactions initiated by our platform wallet.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">Out of scope</h2>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground">
              <li>
                Third-party protocols we integrate with (x402, USDC, Base).
                Report those upstream.
              </li>
              <li>
                Denial-of-service that requires a botnet or exceeds reasonable
                testing bounds.
              </li>
              <li>
                Issues requiring physical access, social engineering of our
                maintainers, or compromise of a contributor's personal
                accounts.
              </li>
              <li>Third-party agents or services registered on the marketplace.</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">Bounty</h2>
            <p className="text-muted-foreground leading-relaxed">
              We don't run a paid bounty program yet. As the project grows and
              on-chain volume increases, we'll revisit. For now: credit, our
              gratitude, and a prompt fix.
            </p>
          </section>
        </div>
      </main>
      <FooterSection />
    </>
  );
}
