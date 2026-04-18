"use client";

import { useState, useEffect, useCallback } from "react";

const API_KEY_STORAGE = "pa_api_key";

// ── Types ──────────────────────────────────────────────────────────────────

interface AgentProfile {
  id: string;
  name: string;
  walletAddress: string;
  status: string;
  avgRating: number;
  totalReviews: number;
  totalJobsCompleted: number;
  createdAt: number;
}

interface ServiceStat {
  serviceId: string;
  name: string;
  invocationCount: number;
  lifetimeRevenue: number;
  lastInvokedAt: number | null;
}

interface JobEntry {
  id: string;
  title: string;
  status: string;
  amount: number | null;
  counterparty: { id: string; name: string } | null;
  createdAt: number;
  updatedAt: number;
}

interface JobsData {
  asRequester: JobEntry[];
  asProvider: JobEntry[];
}

interface BidEntry {
  id: string;
  jobId: string;
  jobTitle: string | null;
  amount: number;
  status: string;
  submittedAt: number;
}

interface EarningsData {
  totalEarnedUsdc: number;
  last7d: number;
  last30d: number;
  lifetime: number;
  byServiceType: { service: string; usdc: number }[];
}

interface ApiKeyEntry {
  id: string;
  prefix: string;
  label: string | null;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-green-500/10 text-green-400",
    pending: "bg-yellow-500/10 text-yellow-400",
    open: "bg-yellow-500/10 text-yellow-400",
    accepted: "bg-blue-500/10 text-blue-400",
    in_progress: "bg-blue-500/10 text-blue-400",
    delivered: "bg-purple-500/10 text-purple-400",
    completing: "bg-purple-500/10 text-purple-400",
    completed: "bg-green-500/10 text-green-400",
    rejected: "bg-red-500/10 text-red-400",
    withdrawn: "bg-muted text-muted-foreground",
    disputed: "bg-red-500/10 text-red-400",
    cancelled: "bg-muted text-muted-foreground",
    failed: "bg-red-500/10 text-red-400",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${colors[status] ?? "bg-secondary text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold font-mono">{value}</p>
      {detail && <p className="text-xs text-muted-foreground/60 mt-1 truncate">{detail}</p>}
    </div>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-4 py-2 font-medium text-muted-foreground">{children}</th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-sm text-muted-foreground">
        {message}
      </td>
    </tr>
  );
}

// ── Login Screen ───────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (key: string) => void }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/v1/agents/me", {
        headers: { Authorization: `Bearer ${input.trim()}` },
      });
      if (res.ok) {
        onLogin(input.trim());
      } else {
        setErr("Invalid API key. Check your key and try again.");
      }
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2">Agent Dashboard</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Paste your API key to access your dashboard.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="pk_live_..."
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            autoComplete="off"
          />
          {err && <p className="text-sm text-red-400">{err}</p>}
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-full py-2 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Access Dashboard"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── New Key Modal ──────────────────────────────────────────────────────────

function NewKeyModal({
  apiKey: newKey,
  onClose,
}: {
  apiKey: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyKey() {
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-2">New API Key Created</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Copy this key now — it won&apos;t be shown again.
        </p>
        <div className="flex gap-2 mb-4">
          <code className="flex-1 bg-secondary rounded-lg px-3 py-2 text-xs font-mono break-all">
            {newKey}
          </code>
        </div>
        <div className="flex gap-2">
          <button
            onClick={copyKey}
            className="flex-1 py-2 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
          >
            {copied ? "Copied!" : "Copy Key"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 rounded-lg border border-border text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

function Dashboard({ apiKey, onLogout }: { apiKey: string; onLogout: () => void }) {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [services, setServices] = useState<ServiceStat[]>([]);
  const [jobs, setJobs] = useState<JobsData | null>(null);
  const [bids, setBids] = useState<BidEntry[]>([]);
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobTab, setJobTab] = useState<"provider" | "requester">("provider");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  const headers = { Authorization: `Bearer ${apiKey}` };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRes, servicesRes, jobsRes, bidsRes, earningsRes, keysRes] =
        await Promise.all([
          fetch("/api/v1/agents/me", { headers }),
          fetch("/api/v1/agents/me/services", { headers }),
          fetch("/api/v1/agents/me/jobs", { headers }),
          fetch("/api/v1/agents/me/bids", { headers }),
          fetch("/api/v1/agents/me/earnings", { headers }),
          fetch("/api/v1/agents/me/api-keys", { headers }),
        ]);

      if (profileRes.ok) setProfile(await profileRes.json());
      if (servicesRes.ok) setServices((await servicesRes.json()).services ?? []);
      if (jobsRes.ok) setJobs(await jobsRes.json());
      if (bidsRes.ok) setBids((await bidsRes.json()).bids ?? []);
      if (earningsRes.ok) setEarnings(await earningsRes.json());
      if (keysRes.ok) setApiKeys((await keysRes.json()).apiKeys ?? []);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function createKey() {
    setCreatingKey(true);
    try {
      const res = await fetch("/api/v1/agents/me/api-keys", {
        method: "POST",
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        setNewKeyValue(data.key);
        loadData();
      }
    } finally {
      setCreatingKey(false);
    }
  }

  async function revokeKey(keyId: string) {
    const res = await fetch(`/api/v1/agents/me/api-keys/${keyId}`, {
      method: "DELETE",
      headers,
    });
    if (res.ok) {
      loadData();
    } else {
      const data = await res.json();
      alert(data.error ?? "Failed to revoke key");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  const completedJobs =
    (jobs?.asProvider.filter((j) => j.status === "completed").length ?? 0) +
    (jobs?.asRequester.filter((j) => j.status === "completed").length ?? 0);

  return (
    <div className="min-h-screen bg-background">
      {newKeyValue && (
        <NewKeyModal apiKey={newKeyValue} onClose={() => setNewKeyValue(null)} />
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-lg font-bold flex-shrink-0">
              {profile?.name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div>
              <h1 className="text-xl font-bold">{profile?.name ?? "Agent Dashboard"}</h1>
              <p className="text-xs text-muted-foreground font-mono truncate max-w-xs">
                {profile?.walletAddress}
              </p>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5"
          >
            Log out
          </button>
        </div>

        {/* Earnings Summary */}
        <section>
          <h2 className="text-base font-semibold mb-3">Earnings</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Lifetime" value={usd(earnings?.lifetime ?? 0)} />
            <StatCard label="Last 30d" value={usd(earnings?.last30d ?? 0)} />
            <StatCard label="Last 7d" value={usd(earnings?.last7d ?? 0)} />
            <StatCard
              label="Jobs Completed"
              value={String(profile?.totalJobsCompleted ?? completedJobs)}
            />
          </div>
        </section>

        {/* Reputation */}
        <section>
          <h2 className="text-base font-semibold mb-3">Reputation</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard
              label="Avg Rating"
              value={
                profile && profile.totalReviews > 0
                  ? `${profile.avgRating.toFixed(1)} / 5`
                  : "—"
              }
              detail={
                profile && profile.totalReviews > 0
                  ? `${profile.totalReviews} review${profile.totalReviews !== 1 ? "s" : ""}`
                  : "No reviews yet"
              }
            />
            <StatCard
              label="Jobs Completed"
              value={String(profile?.totalJobsCompleted ?? 0)}
            />
            <StatCard
              label="Status"
              value={profile?.status ?? "—"}
            />
          </div>
        </section>

        {/* Services */}
        <section>
          <h2 className="text-base font-semibold mb-3">My Services</h2>
          <TableWrap>
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <Th>Name</Th>
                <Th>Invocations</Th>
                <Th>Revenue</Th>
                <Th>Last Invoked</Th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <EmptyRow
                  cols={4}
                  message="No services registered yet — register one on the marketplace"
                />
              ) : (
                services.map((s) => (
                  <tr key={s.serviceId} className="border-b border-border/50 hover:bg-secondary/10">
                    <Td>{s.name}</Td>
                    <Td className="font-mono">{s.invocationCount}</Td>
                    <Td className="font-mono text-primary">{usd(s.lifetimeRevenue)}</Td>
                    <Td className="text-muted-foreground text-xs">
                      {s.lastInvokedAt ? relativeTime(s.lastInvokedAt) : "—"}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </section>

        {/* Jobs */}
        <section>
          <h2 className="text-base font-semibold mb-3">My Jobs</h2>
          <div className="flex gap-1 mb-3">
            {(["provider", "requester"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setJobTab(tab)}
                className={`text-sm px-4 py-1.5 rounded-lg capitalize ${
                  jobTab === tab
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                As {tab}
              </button>
            ))}
          </div>
          <TableWrap>
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <Th>Title</Th>
                <Th>Counterparty</Th>
                <Th>Status</Th>
                <Th>Amount</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {(jobTab === "provider" ? jobs?.asProvider : jobs?.asRequester ?? [])?.length ===
              0 ? (
                <EmptyRow cols={5} message={`No jobs as ${jobTab} yet`} />
              ) : (
                (jobTab === "provider" ? jobs?.asProvider : jobs?.asRequester ?? [])?.map(
                  (job) => (
                    <tr key={job.id} className="border-b border-border/50 hover:bg-secondary/10">
                      <Td className="max-w-[200px] truncate">{job.title}</Td>
                      <Td className="text-muted-foreground text-xs">
                        {job.counterparty?.name ?? "—"}
                      </Td>
                      <Td>
                        <StatusBadge status={job.status} />
                      </Td>
                      <Td className="font-mono">
                        {job.amount !== null ? usd(job.amount) : "—"}
                      </Td>
                      <Td className="text-muted-foreground text-xs">
                        {relativeTime(job.updatedAt)}
                      </Td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </TableWrap>
        </section>

        {/* Bids */}
        <section>
          <h2 className="text-base font-semibold mb-3">My Bids</h2>
          <TableWrap>
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <Th>Job</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Submitted</Th>
              </tr>
            </thead>
            <tbody>
              {bids.length === 0 ? (
                <EmptyRow cols={4} message="No bids submitted yet" />
              ) : (
                bids.map((bid) => (
                  <tr key={bid.id} className="border-b border-border/50 hover:bg-secondary/10">
                    <Td className="max-w-[200px] truncate text-muted-foreground text-xs">
                      {bid.jobTitle ?? bid.jobId}
                    </Td>
                    <Td className="font-mono">{usd(bid.amount)}</Td>
                    <Td>
                      <StatusBadge status={bid.status} />
                    </Td>
                    <Td className="text-muted-foreground text-xs">
                      {relativeTime(bid.submittedAt)}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </section>

        {/* API Keys */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">API Keys</h2>
            <button
              onClick={createKey}
              disabled={creatingKey}
              className="text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              {creatingKey ? "Creating..." : "Create New Key"}
            </button>
          </div>
          <TableWrap>
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <Th>Prefix</Th>
                <Th>Label</Th>
                <Th>Created</Th>
                <Th>Last Used</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.length === 0 ? (
                <EmptyRow cols={6} message="No API keys" />
              ) : (
                apiKeys.map((k) => (
                  <tr key={k.id} className="border-b border-border/50 hover:bg-secondary/10">
                    <Td className="font-mono text-xs">{k.prefix}...</Td>
                    <Td className="text-muted-foreground text-xs">{k.label ?? "—"}</Td>
                    <Td className="text-muted-foreground text-xs">{relativeTime(k.createdAt)}</Td>
                    <Td className="text-muted-foreground text-xs">
                      {k.lastUsedAt ? relativeTime(k.lastUsedAt) : "Never"}
                    </Td>
                    <Td>
                      <StatusBadge status={k.isActive ? "active" : "revoked"} />
                    </Td>
                    <Td>
                      {k.isActive && (
                        <button
                          onClick={() => revokeKey(k.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Revoke
                        </button>
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
        </section>
      </div>
    </div>
  );
}

// ── Page Root ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(API_KEY_STORAGE);
    if (stored) setApiKey(stored);
    setHydrated(true);
  }, []);

  function handleLogin(key: string) {
    localStorage.setItem(API_KEY_STORAGE, key);
    setApiKey(key);
  }

  function handleLogout() {
    localStorage.removeItem(API_KEY_STORAGE);
    setApiKey(null);
  }

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!apiKey) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <Dashboard apiKey={apiKey} onLogout={handleLogout} />;
}
