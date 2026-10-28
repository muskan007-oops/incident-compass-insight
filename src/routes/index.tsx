import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Gauge, Search, ShieldAlert, Timer } from "lucide-react";
import { overviewQuery } from "@/lib/data-source";
import { fmtDate, HypothesisBadge, SeverityBadge, StatusPill } from "@/components/status";
import type { IncidentStatus, Severity } from "@/lib/analysis/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Incidents · AI-Based Incident Root Cause Analysis" },
      { name: "description", content: "Explore active incidents and evidence-ranked candidate root causes." },
      { property: "og:title", content: "Incidents · AI-Based Incident Root Cause Analysis" },
      { property: "og:description", content: "Explore active incidents and evidence-ranked candidate root causes." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery()),
  component: Index,
});

function Index() {
  const { data } = useSuspenseQuery(overviewQuery());
  const [sev, setSev] = useState<Severity | "all">("all");
  const [status, setStatus] = useState<IncidentStatus | "all">("all");
  const [q, setQ] = useState("");

  const rows = useMemo(
    () =>
      data.filter(
        ({ incident: i }) =>
          (sev === "all" || i.severity === sev) &&
          (status === "all" || i.status === status) &&
          `${i.id} ${i.title} ${i.affectedService}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [data, sev, status, q],
  );

  const open = data.filter((d) => d.incident.status !== "resolved").length;
  const sev1 = data.filter((d) => d.incident.severity === "SEV1").length;
  const insufficient = data.filter((d) => d.analysis.verdict === "insufficient_evidence").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Incident overview</h1>
        <p className="text-sm text-muted-foreground">Correlating logs, metrics, traces and change events to rank candidate root causes.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={ShieldAlert} label="Open incidents" value={open} tone="warning" />
        <Kpi icon={AlertTriangle} label="SEV1" value={sev1} tone="destructive" />
        <Kpi icon={Gauge} label="Incidents tracked" value={data.length} tone="primary" />
        <Kpi icon={Timer} label="Insufficient evidence" value={insufficient} tone="muted" />
      </div>

      <div className="panel flex flex-col gap-3 p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by ID, title or service"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Seg value={sev} onChange={setSev} options={["all", "SEV1", "SEV2", "SEV3"]} />
        <Seg value={status} onChange={setStatus} options={["all", "investigating", "mitigated", "resolved"]} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ incident: i, analysis: a }) => {
          const top = a.candidates[0];
          return (
            <Link key={i.id} to="/incidents/$id" params={{ id: i.id }} className="panel group flex flex-col gap-4 p-4 transition-colors hover:border-primary/60">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={i.severity} />
                  <span className="font-mono text-xs text-muted-foreground">{i.id}</span>
                </div>
                <StatusPill status={i.status} />
              </div>
              <div>
                <div className="font-medium leading-snug">{i.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{fmtDate(i.startedAt)}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Stat label="Service" value={i.affectedService} mono />
                <Stat label="p99 latency" value={`${i.latencyP99Ms} ms`} sub={`base ${i.baselineLatencyMs}`} bad={i.latencyP99Ms > i.baselineLatencyMs * 2} />
                <Stat label="Error rate" value={`${i.errorRate}%`} sub={`base ${i.baselineErrorRate}%`} bad={i.errorRate > i.baselineErrorRate * 3} />
              </div>
              <div className="mt-auto rounded-md border border-border bg-background/50 p-3 text-xs">
                {a.verdict === "insufficient_evidence" ? (
                  <div className="flex items-center gap-2 text-warning">
                    <AlertTriangle className="size-3.5" /> Insufficient evidence
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Top candidate · {(top.score * 100).toFixed(0)}%</span>
                      <HypothesisBadge confirmed={top.isConfirmed} />
                    </div>
                    <div className="line-clamp-1">{top.title}</div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-primary">
                Investigate <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          );
        })}
        {!rows.length && <div className="text-sm text-muted-foreground">No incidents match these filters.</div>}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof Gauge; label: string; value: number; tone: "warning" | "destructive" | "primary" | "muted" }) {
  const t = { warning: "text-warning", destructive: "text-destructive", primary: "text-primary", muted: "text-muted-foreground" }[tone];
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={cn("size-4", t)} /> {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Stat({ label, value, sub, mono, bad }: { label: string; value: string; sub?: string; mono?: boolean; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("truncate font-medium", mono && "font-mono", bad && "text-destructive")}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly T[] }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-md border border-border bg-background p-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn("rounded px-2.5 py-1 text-xs capitalize text-muted-foreground transition-colors hover:text-foreground", value === o && "bg-secondary text-foreground")}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
