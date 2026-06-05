"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

const WINDOWS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function pct(rate: number): string {
  return (rate * 100).toFixed(1) + "%";
}

function RatioBar({ rate }: { rate: number }) {
  const color =
    rate >= 0.95 ? "bg-green-500" : rate >= 0.8 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${rate * 100}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground">{pct(rate)}</span>
    </div>
  );
}

function WebhookHealthDashboard() {
  const params = useSearchParams();
  const adminKey = params.get("key") ?? "";
  const windowParam = params.get("window") ?? "24h";
  const windowMs = WINDOWS[windowParam] ?? WINDOWS["24h"];

  const health = useQuery(api.webhooks.getDeliveryHealth, { windowMs });

  const windowLink = (w: string) =>
    `/admin/webhooks/health?key=${encodeURIComponent(adminKey)}&window=${w}`;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Webhook Delivery Health</h1>
            <p className="text-sm text-muted-foreground">Aggregate delivery stats from the {windowParam} window</p>
          </div>
          <Link
            href={`/admin?key=${encodeURIComponent(adminKey)}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Admin
          </Link>
        </div>

        {/* Window selector */}
        <div className="flex gap-2 mb-8">
          {(["24h", "7d", "30d"] as const).map((w) => (
            <Link
              key={w}
              href={windowLink(w)}
              className={`px-3 py-1 rounded-md text-sm font-mono border transition-colors ${
                windowParam === w
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
              }`}
            >
              {w}
            </Link>
          ))}
        </div>

        {!health ? (
          <div className="text-muted-foreground">Loading...</div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <StatCard
                label="Success Rate"
                value={pct(health.successRate)}
                detail={`${health.successCount} / ${health.totalAttempts} attempts`}
                accent={
                  health.successRate >= 0.95
                    ? "green"
                    : health.successRate >= 0.8
                    ? "yellow"
                    : "red"
                }
              />
              <StatCard
                label="Total Attempts"
                value={String(health.totalAttempts)}
                detail={`${health.windowMs / 3_600_000}h window`}
              />
              <StatCard
                label="Gave Up"
                value={String(health.attemptDistribution.gaveUp)}
                detail="exhausted all 3 attempts"
                accent={health.attemptDistribution.gaveUp > 0 ? "red" : undefined}
              />
            </div>

            {/* By event */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-3">By Event</h2>
              {health.byEvent.length === 0 ? (
                <p className="text-sm text-muted-foreground">No deliveries in window.</p>
              ) : (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Event</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Attempts</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Successes</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {health.byEvent.map((row) => (
                        <tr key={row.event} className="border-b border-border/50 hover:bg-secondary/10">
                          <td className="px-4 py-2 font-mono text-xs">{row.event}</td>
                          <td className="px-4 py-2 font-mono">{row.attempts}</td>
                          <td className="px-4 py-2 font-mono">{row.successCount}</td>
                          <td className="px-4 py-2">
                            <RatioBar rate={row.successRate} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Attempt distribution */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-3">Attempt Distribution</h2>
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <DistBucket label="1st attempt" value={health.attemptDistribution.deliveredOnAttempt1} accent="green" />
                  <DistBucket label="2nd attempt" value={health.attemptDistribution.deliveredOnAttempt2} accent="yellow" />
                  <DistBucket label="3rd attempt" value={health.attemptDistribution.deliveredOnAttempt3} accent="orange" />
                  <DistBucket label="Gave up" value={health.attemptDistribution.gaveUp} accent="red" />
                </div>
                {health.totalAttempts > 0 && (
                  <div className="mt-4 h-3 flex rounded-full overflow-hidden gap-px">
                    <DistBar
                      share={(health.attemptDistribution.deliveredOnAttempt1 / health.totalAttempts)}
                      color="bg-green-500"
                    />
                    <DistBar
                      share={(health.attemptDistribution.deliveredOnAttempt2 / health.totalAttempts)}
                      color="bg-yellow-500"
                    />
                    <DistBar
                      share={(health.attemptDistribution.deliveredOnAttempt3 / health.totalAttempts)}
                      color="bg-orange-500"
                    />
                    <DistBar
                      share={(health.attemptDistribution.gaveUp / health.totalAttempts)}
                      color="bg-red-500"
                    />
                  </div>
                )}
              </div>
            </section>

            {/* Recent failures */}
            <section>
              <h2 className="text-lg font-semibold mb-3">Recent Failures</h2>
              {health.recentFailures.length === 0 ? (
                <p className="text-sm text-muted-foreground">No failures in window.</p>
              ) : (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-secondary/30">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">When</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">URL</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Event</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Attempt</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Error / ms</th>
                        </tr>
                      </thead>
                      <tbody>
                        {health.recentFailures.map((f, i) => (
                          <tr key={`${f.creationTime}-${i}`} className="border-b border-border/50 hover:bg-secondary/10">
                            <td className="px-4 py-2 text-muted-foreground text-xs whitespace-nowrap">
                              {relativeTime(f.creationTime)}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                              {truncate(f.url, 40)}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs">{f.event}</td>
                            <td className="px-4 py-2 font-mono text-center">{f.attempt}</td>
                            <td className="px-4 py-2 font-mono">
                              {f.statusCode != null ? (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
                                  {f.statusCode}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              {f.error
                                ? truncate(f.error, 50)
                                : f.durationMs != null
                                ? `${f.durationMs}ms`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: "green" | "yellow" | "red";
}) {
  const accentClass =
    accent === "green"
      ? "text-green-400"
      : accent === "yellow"
      ? "text-yellow-400"
      : accent === "red"
      ? "text-red-400"
      : "";
  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${accentClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground/60 mt-1">{detail}</p>
    </div>
  );
}

function DistBucket({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "green" | "yellow" | "orange" | "red";
}) {
  const dotClass =
    accent === "green"
      ? "bg-green-500"
      : accent === "yellow"
      ? "bg-yellow-500"
      : accent === "orange"
      ? "bg-orange-500"
      : "bg-red-500";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className="text-xl font-bold font-mono">{value}</span>
    </div>
  );
}

function DistBar({ share, color }: { share: number; color: string }) {
  if (share <= 0) return null;
  return <div className={`${color}`} style={{ width: `${share * 100}%` }} />;
}

export default function WebhookHealthPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
          Loading...
        </div>
      }
    >
      <WebhookHealthDashboard />
    </Suspense>
  );
}
