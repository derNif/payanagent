import { promises as fs } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { marked } from "marked";
import Link from "next/link";
import type { Metadata } from "next";

// PayanAgent /docs — Markdown-driven, content in /docs at repo root.
// The catchall slug maps to docs/<slug>.md (root index = docs/index.md).

const DOCS_DIR = path.join(process.cwd(), "docs");

const NAV: Array<{ slug: string; title: string }> = [
  { slug: "", title: "Getting started" },
  { slug: "concepts", title: "Concepts" },
  { slug: "buyer", title: "Buyer guide" },
  { slug: "seller", title: "Seller guide" },
  { slug: "api", title: "HTTP API" },
  { slug: "sdk", title: "TypeScript SDK" },
  { slug: "mcp", title: "MCP server" },
];

async function readDoc(slug: string): Promise<string | null> {
  const filename = slug === "" ? "index.md" : `${slug}.md`;
  const filepath = path.join(DOCS_DIR, filename);
  try {
    return await fs.readFile(filepath, "utf8");
  } catch {
    return null;
  }
}

function slugFromParams(slug?: string[]): string {
  if (!slug || slug.length === 0) return "";
  return slug.join("/");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const s = slugFromParams(slug);
  const entry = NAV.find((n) => n.slug === s);
  const title = entry ? `${entry.title} — PayanAgent docs` : "PayanAgent docs";
  return { title };
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const s = slugFromParams(slug);
  const md = await readDoc(s);
  if (md === null) {
    notFound();
  }
  const html = marked.parse(md, { async: false });

  const current = NAV.find((n) => n.slug === s);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-col lg:flex-row gap-10">
        <aside className="lg:w-56 shrink-0">
          <nav className="text-sm">
            <div className="text-foreground/60 mb-2 font-medium">Docs</div>
            <ul className="space-y-1">
              {NAV.map((n) => {
                const href = n.slug === "" ? "/docs" : `/docs/${n.slug}`;
                const active = current?.slug === n.slug;
                return (
                  <li key={n.slug}>
                    <Link
                      href={href}
                      className={
                        active
                          ? "block py-1 px-2 rounded bg-secondary text-foreground"
                          : "block py-1 px-2 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      }
                    >
                      {n.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 text-xs text-muted-foreground/70">
              <Link href="/" className="hover:text-foreground">
                ← Back to payanagent.com
              </Link>
            </div>
          </nav>
        </aside>
        <article
          className="prose prose-invert max-w-none flex-1 prose-headings:font-mono prose-code:bg-secondary prose-code:px-1 prose-code:rounded"
          dangerouslySetInnerHTML={{ __html: html as string }}
        />
      </div>
    </div>
  );
}
