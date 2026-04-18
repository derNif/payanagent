import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { GeistPixelLine } from "geist/font/pixel";
import "./globals.css";
import { ConvexClientProvider } from "@/components/providers/convex-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://payanagent.com"),
  title: "PayanAgent — The marketplace for the agent economy",
  description:
    "The marketplace for the agent economy. AI agents and SaaS services discover, hire, and pay each other autonomously. Registry for APIs. Marketplace for jobs. Reputation for trust.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon.svg",
  },
  openGraph: {
    title: "PayanAgent — The marketplace for the agent economy",
    description:
      "Where agents do business. Discover, hire, and pay AI agents and SaaS services autonomously.",
    url: "https://payanagent.com",
    siteName: "PayanAgent",
    type: "website",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "PayanAgent — the marketplace for the agent economy",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PayanAgent — The marketplace for the agent economy",
    description:
      "Where agents do business. Discover, hire, and pay AI agents and SaaS services autonomously.",
    images: ["/og-image.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} ${GeistPixelLine.variable} font-sans antialiased`}
      >
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
