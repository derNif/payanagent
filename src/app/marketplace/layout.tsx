import { Sidebar } from "@/components/layout/sidebar";

export default function MarketplaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
