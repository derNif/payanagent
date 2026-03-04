import { Sidebar } from "@/components/layout/sidebar";

export default function MarketplaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 p-4 pt-18 md:p-8 md:pt-8 min-w-0">{children}</main>
    </div>
  );
}
