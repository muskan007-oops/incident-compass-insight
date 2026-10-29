import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, Gauge, Search, ShieldAlert, Timer } from "lucide-react";
import { ingestIncident, ingestLog, overviewQuery } from "@/lib/data-source";
import { fmtDate, HypothesisBadge, Seg, SeverityBadge, StatusPill } from "@/components/status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Incident, IncidentStatus, LogEntry, Severity } from "@/lib/analysis/types";
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
  const queryClient = useQueryClient();
  const [sev, setSev] = useState<Severity | "all">("all");
  const [status, setStatus] = useState<IncidentStatus | "all">("all");
  const [q, setQ] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [telemetryJson, setTelemetryJson] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Incident overview</h1>
          <p className="text-sm text-muted-foreground">Correlating logs, metrics, traces and change events to rank candidate root causes.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setSubmitError(null)}><Activity /> Ingest telemetry</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ingest live telemetry</DialogTitle>
              <DialogDescription>Submit a complete incident object or a log object with its incidentId.</DialogDescription>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                setSubmitError(null);
                try {
                  const payload: unknown = JSON.parse(telemetryJson);
                  if (isLogSubmission(payload)) {
                    await ingestLog(payload.incidentId, payload.log);
                  } else if (isIncidentPayload(payload)) {
                    await ingestIncident(payload);
                  } else {
                    throw new Error("Expected a complete incident JSON object or { incidentId, log }.");
                  }
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["overview"] }),
                    queryClient.invalidateQueries({ queryKey: ["incidents"] }),
                    queryClient.invalidateQueries({ queryKey: ["incident"] }),
                  ]);
                  setTelemetryJson("");
                  setDialogOpen(false);
                } catch (error) {
                  setSubmitError(error instanceof Error ? error.message : "Unable to ingest telemetry.");
                }
              }}
            >
              <textarea
                value={telemetryJson}
                onChange={(event) => setTelemetryJson(event.target.value)}
                placeholder={'{\n  "incidentId": "INC-2042",\n  "log": {\n    "id": "live-log-001",\n    "ts": "2026-10-29T12:00:00.000Z",\n    "service": "auth-gateway",\n    "level": "ERROR",\n    "message": "Token refresh requests timing out"\n  }\n}'}
                aria-label="Incident or log JSON payload"
                className="min-h-64 w-full resize-y rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                required
              />
              {submitError && <p role="alert" className="text-sm text-destructive">{submitError}</p>}
              <DialogFooter>
                <Button type="submit"><Activity /> Submit telemetry</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
                {a.verdict === "insufficient_evidence" || !top ? (
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLogEntry(value: unknown): value is LogEntry {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.ts === "string" &&
    Number.isFinite(Date.parse(value.ts)) && typeof value.service === "string" &&
    ["ERROR", "WARN", "INFO"].includes(String(value.level)) && typeof value.message === "string";
}

function isLogSubmission(value: unknown): value is { incidentId: string; log: LogEntry } {
  if (!isRecord(value) || typeof value.incidentId !== "string") return false;
  return isLogEntry(value.log);
}

function isIncidentPayload(value: unknown): value is Incident {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.title === "string" &&
    ["SEV1", "SEV2", "SEV3"].includes(String(value.severity)) &&
    ["investigating", "mitigated", "resolved"].includes(String(value.status)) &&
    typeof value.affectedService === "string" && typeof value.startedAt === "string" &&
    typeof value.detectedAt === "string" && typeof value.summary === "string" &&
    typeof value.latencyP99Ms === "number" && typeof value.baselineLatencyMs === "number" &&
    typeof value.errorRate === "number" && typeof value.baselineErrorRate === "number" &&
    Array.isArray(value.services) && Array.isArray(value.logs) && Array.isArray(value.metrics) &&
    Array.isArray(value.traces) && Array.isArray(value.changes);
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

