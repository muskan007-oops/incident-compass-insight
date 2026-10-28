import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, RefreshCw, CheckCircle2, Download, GitCommit, Info, Network, Search } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { incidentQuery } from "@/lib/data-source";
import { buildTimeline, downloadCsv, findingsCsv, timelineCsv } from "@/lib/export";
import { dependencyDistance } from "@/lib/analysis/engine";
import type { AnalysisResult, CandidateCause, Incident, LogLevel } from "@/lib/analysis/types";
import { fmtDate, fmtTime, HypothesisBadge, LevelTag, Seg, SeverityBadge, StatusPill } from "@/components/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/incidents/$id")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(incidentQuery(params.id));
    if (!data) throw notFound();
    return { title: data.incident.title };
  },
  head: ({ params, loaderData }) => ({
    meta: [
      { title: `${params.id} · ${loaderData?.title ?? "Incident"} · RCA` },
      { name: "description", content: `Root cause ranking, evidence and timeline for ${params.id}.` },
      { property: "og:title", content: `${params.id} · Incident root cause analysis` },
      { property: "og:description", content: `Root cause ranking, evidence and timeline for ${params.id}.` },
    ],
  }),
  notFoundComponent: () => (
    <div className="p-8 text-center text-muted-foreground">
      Incident not found. <Link to="/" className="text-primary">Back to incidents</Link>
    </div>
  ),
  component: IncidentPage,
});

function IncidentPage() {
  const { id } = Route.useParams();
  const { data, refetch, isFetching } = useSuspenseQuery(incidentQuery(id));
  const qc = useQueryClient();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const { incident, analysis } = data!;
  const [selected, setSelected] = useState(analysis.candidates[0]?.changeId);
  const candidate = analysis.candidates.find((c) => c.changeId === selected) ?? analysis.candidates[0];

  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const rerun = async () => {
    setAnalyzeError(null);
    // Read-only: re-scores the selected incident's recorded evidence; never touches services.
    const r = await refetch();
    qc.invalidateQueries({ queryKey: ["overview"] });
    if (r.isError || !r.data) {
      const msg = r.error instanceof Error ? r.error.message : "Analysis could not be completed.";
      setAnalyzeError(msg);
      toast.error("Analysis failed");
      return;
    }
    const top = r.data.analysis.candidates[0];
    if (!r.data.analysis.candidates.some((c) => c.changeId === selected)) setSelected(top?.changeId);
    toast.success(
      r.data.analysis.verdict === "insufficient_evidence"
        ? "Analysis complete: Unknown — insufficient evidence"
        : `Analysis complete: top hypothesis ${top?.changeId} (${((top?.score ?? 0) * 100).toFixed(0)}%)`,
    );
  };

  const exportTimeline = () => {
    downloadCsv(timelineCsv(incident), `${incident.id}-timeline.csv`);
    toast.success("Timeline exported");
  };
  const exportFindings = () => {
    downloadCsv(findingsCsv(incident, analysis), `${incident.id}-findings.csv`);
    toast.success("Findings exported");
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" /> All incidents
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <span className="font-mono text-sm text-muted-foreground">{incident.id}</span>
            <StatusPill status={incident.status} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{incident.title}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{incident.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            Analyzed {hydrated && analysis.analyzedAt ? `${fmtTime(analysis.analyzedAt)} UTC` : "—"}
          </span>
          <button onClick={rerun} disabled={isFetching} className="inline-flex h-9 items-center gap-2 rounded-md border border-primary/60 bg-secondary px-3 text-sm hover:bg-accent disabled:opacity-60">
            <RefreshCw className={cn("size-4", isFetching && "animate-spin")} /> {isFetching ? "Analyzing…" : "Analyze incident"}
          </button>
          <button onClick={exportTimeline} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary px-3 text-sm hover:bg-accent">
            <Download className="size-4" /> Timeline CSV
          </button>
          <button onClick={exportFindings} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Download className="size-4" /> Findings CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Severity" value={incident.severity} sub={`Detected ${fmtDate(incident.detectedAt)}`} tone={incident.severity === "SEV1" ? "destructive" : incident.severity === "SEV2" ? "warning" : "info"} />
        <Card label="Affected service" value={incident.affectedService} sub={`${incident.services.length} services in graph`} mono />
        <Card label="p99 latency" value={`${incident.latencyP99Ms} ms`} sub={`${(incident.latencyP99Ms / incident.baselineLatencyMs).toFixed(1)}× baseline (${incident.baselineLatencyMs} ms)`} tone="destructive" />
        <Card label="Error rate" value={`${incident.errorRate}%`} sub={`baseline ${incident.baselineErrorRate}%`} tone="warning" />
      </div>

      <MetricsChart incident={incident} />

      <Verdict analysis={analysis} incident={incident} />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-2">
          <SectionTitle>Root cause ranking · top {analysis.candidates.length}</SectionTitle>
          {analysis.candidates.map((c, idx) => (
            <button
              key={c.changeId}
              onClick={() => setSelected(c.changeId)}
              className={cn("panel w-full p-4 text-left transition-colors hover:border-primary/50", candidate?.changeId === c.changeId && "border-primary")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid size-6 place-items-center rounded bg-secondary font-mono text-xs">#{idx + 1}</span>
                  <span className="font-mono text-xs text-muted-foreground">{c.changeId}</span>
                </div>
                <HypothesisBadge confirmed={c.isConfirmed} />
              </div>
              <div className="mt-2 text-sm font-medium leading-snug">{c.title}</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">{c.service}</div>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", c.confidence === "high" ? "bg-destructive" : c.confidence === "medium" ? "bg-warning" : "bg-muted-foreground")}
                    style={{ width: `${c.score * 100}%` }}
                  />
                </div>
                <span className="w-10 text-right font-mono text-sm">{(c.score * 100).toFixed(0)}%</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">{c.confidence === "high" ? "High" : c.confidence === "medium" ? "Medium" : "Low"} confidence · hypothesis, not confirmed by the engine</div>
              <div className="mt-3 grid grid-cols-5 gap-1 text-center text-[10px]">
                {c.signals.map((sg) => (
                  <div key={sg.key} className="rounded bg-background/60 px-1 py-1" title={sg.explanation}>
                    <div className="truncate text-muted-foreground">{sg.label.split(" ")[0]}</div>
                    <div className={cn("font-mono", sg.score > 0 ? "text-foreground" : "text-muted-foreground")}>{(sg.score * sg.weight * 100).toFixed(1)}</div>
                  </div>
                ))}
              </div>
              {c.adjustment && <div className="mt-2 text-[11px] text-warning">{c.adjustment}</div>}
            </button>
          ))}
          {!analysis.candidates.length && <div className="panel p-4 text-sm text-muted-foreground">No change events to evaluate.</div>}
        </section>

        <section className="space-y-3 lg:col-span-3">
          <SectionTitle>Evidence behind ranking {candidate && <span className="font-mono text-primary">{candidate.changeId}</span>}</SectionTitle>
          {candidate ? <EvidencePanel incident={incident} c={candidate} /> : <div className="panel p-4 text-sm text-muted-foreground">Select a candidate.</div>}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-2">
          <SectionTitle>Service dependencies</SectionTitle>
          <DependencyMap incident={incident} highlight={candidate?.service} />
        </section>
        <section className="space-y-3 lg:col-span-3">
          <SectionTitle>Incident timeline</SectionTitle>
          <Timeline incident={incident} analysis={analysis} />
        </section>
      </div>

      <section className="space-y-3">
        <SectionTitle>Log explorer</SectionTitle>
        <LogExplorer incident={incident} evidenceIds={candidate?.signals.flatMap((s) => s.evidenceIds) ?? []} />
      </section>

      <section className="space-y-3">
        <SectionTitle>Traces</SectionTitle>
        <TraceTable incident={incident} />
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>;
}

function Card({ label, value, sub, tone, mono }: { label: string; value: string; sub: string; tone?: "destructive" | "warning" | "info"; mono?: boolean }) {
  const t = tone ? { destructive: "text-destructive", warning: "text-warning", info: "text-info" }[tone] : "";
  return (
    <div className="panel p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate text-lg font-semibold md:text-xl", t, mono && "font-mono text-base md:text-lg")}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function Verdict({ analysis, incident }: { analysis: AnalysisResult; incident: Incident }) {
  const confirmed = incident.confirmedRootCause;
  if (confirmed) {
    const c = incident.changes.find((x) => x.id === confirmed.changeId);
    return (
      <div className="panel flex gap-3 border-success/50 p-4">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="text-sm">
          <div className="font-semibold text-success">Confirmed root cause: {c?.description}</div>
          <div className="text-muted-foreground">
            Confirmed by {confirmed.confirmedBy} — {confirmed.note} Engine rankings remain hypotheses; confirmation comes only from humans.
          </div>
        </div>
      </div>
    );
  }
  if (analysis.verdict === "insufficient_evidence")
    return (
      <div className="panel flex gap-3 border-warning/50 p-4">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="text-sm">
          <div className="font-semibold text-warning">Unknown — insufficient evidence</div>
          <div className="text-muted-foreground">{analysis.verdictReason} The root cause cannot be determined from the available data. Collect more logs, traces or change records.</div>
        </div>
      </div>
    );
  return (
    <div className="panel flex gap-3 p-4">
      <Info className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="text-sm">
        <div className="font-semibold">Candidate hypotheses — not yet confirmed</div>
        <div className="text-muted-foreground">{analysis.verdictReason} Verify before acting. Engine: {analysis.engine}.</div>
      </div>
    </div>
  );
}

function EvidencePanel({ incident, c }: { incident: Incident; c: CandidateCause }) {
  const change = incident.changes.find((x) => x.id === c.changeId);
  const ids = new Set(c.signals.flatMap((s) => s.evidenceIds));
  const logs = incident.logs.filter((l) => ids.has(l.id));
  const metrics = incident.metrics.filter((m) => ids.has(m.id));
  const traces = incident.traces.filter((t) => ids.has(t.traceId));
  return (
    <div className="panel divide-y divide-border">
      {change && (
        <div className="flex gap-3 p-4">
          <GitCommit className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="text-sm">
            <div className="font-medium">{change.description}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              <span className="capitalize">{change.type.replace("_", " ")}</span> · {change.service} · by {change.author} · {fmtTime(change.ts)} UTC
            </div>
          </div>
        </div>
      )}
      <div className="space-y-3 p-4">
        <div className="text-xs font-medium text-muted-foreground">
          Score breakdown (weighted sum, points out of 100) · total <span className="font-mono text-foreground">{(c.score * 100).toFixed(1)}</span>
        </div>
        {c.signals.map((s) => (
          <div key={s.key} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-xs">
            <span>{s.label} <span className="text-muted-foreground">×{s.weight}</span></span>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full", s.score > 0 ? "bg-primary" : "bg-transparent")} style={{ width: `${s.score * 100}%` }} />
            </div>
            <span className="w-10 text-right font-mono">{(s.score * s.weight * 100).toFixed(1)}</span>
            <span className="col-span-3 -mt-1 text-muted-foreground">{s.explanation}</span>
          </div>
        ))}
      </div>
      {c.adjustment && <div className="p-4 text-xs text-warning">{c.adjustment}</div>}
      <div className="p-4">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Supporting logs ({logs.length})</div>
        <div className="space-y-1 font-mono text-[11px]">
          {logs.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="text-muted-foreground">{fmtTime(l.ts)}</span>
              <LevelTag level={l.level} />
              <span className="text-muted-foreground">{l.service}</span>
              <span className="min-w-0 break-words">{l.message}</span>
            </div>
          ))}
          {!logs.length && <div className="text-muted-foreground">None.</div>}
        </div>
      </div>
      <div className="p-4">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Anomalous metrics ({metrics.length})</div>
        <div className="flex flex-wrap gap-2">
          {metrics.map((m) => {
            const peak = Math.max(...m.points.map((p) => p.value));
            return (
              <div key={m.id} className="rounded border border-border bg-background/50 px-2 py-1 text-xs">
                <span className="font-mono">{m.service}</span> {m.metric}: <span className="text-destructive">{peak.toFixed(0)}{m.unit}</span>{" "}
                <span className="text-muted-foreground">vs {m.baseline}{m.unit}</span>
              </div>
            );
          })}
          {!metrics.length && <div className="text-xs text-muted-foreground">None.</div>}
        </div>
      </div>
      <div className="p-4">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Supporting traces ({traces.length})</div>
        <div className="flex flex-wrap gap-2 font-mono text-[11px]">
          {traces.map((t) => {
            const span = t.spans.find((sp) => sp.service === c.service);
            return (
              <div key={t.traceId} className="rounded border border-border bg-background/50 px-2 py-1">
                {t.traceId} · {fmtTime(t.ts)} · {c.service} {span ? `${span.durationMs}ms ${span.status}` : ""}
              </div>
            );
          })}
          {!traces.length && <div className="text-muted-foreground">None.</div>}
        </div>
      </div>
    </div>
  );
}

function MetricsChart({ incident }: { incident: Incident }) {
  const options = incident.metrics;
  const [metricId, setMetricId] = useState(options[0]?.id);
  const m = options.find((x) => x.id === metricId) ?? options[0];
  if (!m) return null;
  const data = m.points.map((p) => ({ t: new Date(p.ts).getTime(), value: p.value, baseline: m.baseline }));
  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="text-sm font-medium">
          <span className="font-mono">{m.service}</span> · {m.metric} ({m.unit})
        </div>
        <select value={m.id} onChange={(e) => setMetricId(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.service} · {o.metric}</option>
          ))}
        </select>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: -10, right: 10 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => fmtTime(new Date(t).toISOString()).slice(0, 5)} stroke="var(--color-muted-foreground)" fontSize={11} />
            <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
            <Tooltip
              contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }}
              labelFormatter={(t) => fmtTime(new Date(t as number).toISOString())}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="value" name={m.metric} stroke="var(--color-chart-1)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="baseline" name="baseline" stroke="var(--color-muted-foreground)" strokeDasharray="4 4" dot={false} />
            <ReferenceLine x={new Date(incident.startedAt).getTime()} stroke="var(--color-destructive)" label={{ value: "onset", fill: "var(--color-destructive)", fontSize: 10, position: "top" }} />
            {incident.changes.map((c) => (
              <ReferenceLine key={c.id} x={new Date(c.ts).getTime()} stroke="var(--color-warning)" strokeDasharray="2 3" label={{ value: c.id, fill: "var(--color-warning)", fontSize: 9, position: "insideTopLeft" }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">Red line: impact onset · amber dashed: recorded change events</div>
    </div>
  );
}

function DependencyMap({ incident, highlight }: { incident: Incident; highlight?: string | undefined }) {
  const rows = incident.services
    .map((s) => ({ s, d: dependencyDistance(incident, incident.affectedService, s.name) }))
    .sort((a, b) => (a.d < 0 ? 99 : a.d) - (b.d < 0 ? 99 : b.d));
  return (
    <div className="panel space-y-1.5 p-4">
      {rows.map(({ s, d }) => (
        <div
          key={s.name}
          className={cn(
            "flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs",
            s.name === incident.affectedService && "border-destructive/50 bg-destructive/10",
            s.name === highlight && s.name !== incident.affectedService && "border-primary/60 bg-primary/10",
          )}
          style={{ marginLeft: d > 0 ? d * 16 : 0 }}
        >
          <Network className="size-3.5 text-muted-foreground" />
          <span className="font-mono">{s.name}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {d === 0 ? "affected" : d > 0 ? `upstream · ${d} hop${d > 1 ? "s" : ""}` : "not on path"}
          </span>
        </div>
      ))}
      <div className="pt-2 text-[11px] text-muted-foreground">Indented by dependency distance from the affected service.</div>
    </div>
  );
}

function Timeline({ incident, analysis }: { incident: Incident; analysis: AnalysisResult }) {
  const events = buildTimeline(incident);
  const candidateIds = new Set(analysis.verdict === "insufficient_evidence" ? [] : analysis.candidates.filter((c) => c.score >= 0.45).map((c) => c.changeId));
  return (
    <div className="panel max-h-[460px] overflow-y-auto p-4">
      <ol className="relative space-y-3 border-l border-border pl-5">
        {events.map((e, i) => (
          <li key={i} className="relative">
            <span
              className={cn(
                "absolute -left-[25px] top-1 size-2.5 rounded-full border-2 border-card",
                e.kind === "incident" ? "bg-destructive" : e.kind === "change" ? "bg-warning" : e.severity === "ERROR" ? "bg-destructive/60" : "bg-muted-foreground",
              )}
            />
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
              <span className="font-mono">{fmtTime(e.ts)}</span>
              <span className="uppercase">{e.kind}</span>
              <span className="font-mono">{e.service}</span>
              {candidateIds.has(e.refId) && <span className="text-primary">ranked candidate</span>}
            </div>
            <div className={cn("text-sm", e.kind === "incident" && "font-medium text-destructive")}>{e.description}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LogExplorer({ incident, evidenceIds }: { incident: Incident; evidenceIds: string[] }) {
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [service, setService] = useState("all");
  const [q, setQ] = useState("");
  const [onlyEvidence, setOnlyEvidence] = useState(false);
  const ev = useMemo(() => new Set(evidenceIds), [evidenceIds]);
  const services = Array.from(new Set(incident.logs.map((l) => l.service)));
  const rows = incident.logs.filter(
    (l) =>
      (level === "all" || l.level === level) &&
      (service === "all" || l.service === service) &&
      (!onlyEvidence || ev.has(l.id)) &&
      l.message.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="panel">
      <div className="flex flex-col gap-2 border-b border-border p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter messages…" className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <Seg value={level} onChange={setLevel} options={["all", "ERROR", "WARN", "INFO"]} />
        <select value={service} onChange={(e) => setService(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-xs">
          <option value="all">All services</option>
          {services.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyEvidence} onChange={(e) => setOnlyEvidence(e.target.checked)} className="accent-primary" />
          Evidence only
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left font-mono text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2">Time (UTC)</th><th className="px-3 py-2">Level</th><th className="px-3 py-2">Service</th><th className="px-3 py-2">Message</th><th className="px-3 py-2">Trace</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className={cn("border-b border-border/50", ev.has(l.id) && "bg-primary/5")}>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{fmtTime(l.ts)}</td>
                <td className="px-3 py-1.5"><LevelTag level={l.level} /></td>
                <td className="whitespace-nowrap px-3 py-1.5">{l.service}</td>
                <td className="px-3 py-1.5">{l.message}{ev.has(l.id) && <span className="ml-2 text-[10px] text-primary">evidence</span>}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{l.traceId ?? "—"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No logs match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="p-2 text-right text-[11px] text-muted-foreground">{rows.length} of {incident.logs.length} lines</div>
    </div>
  );
}

function TraceTable({ incident }: { incident: Incident }) {
  if (!incident.traces.length) return <div className="panel p-4 text-sm text-muted-foreground">No traces were captured for this incident.</div>;
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr className="border-b border-border"><th className="px-3 py-2">Trace</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Spans (duration)</th></tr>
        </thead>
        <tbody>
          {incident.traces.map((t) => {
            const max = Math.max(...t.spans.map((s) => s.durationMs));
            return (
              <tr key={t.traceId} className="border-b border-border/50 align-top">
                <td className="px-3 py-2 font-mono">{t.traceId}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{fmtTime(t.ts)}</td>
                <td className="space-y-1 px-3 py-2">
                  {t.spans.map((s, i) => (
                    <div key={i} className="grid grid-cols-[140px_1fr_60px] items-center gap-2">
                      <span className="truncate font-mono">{s.service}</span>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", s.status === "error" ? "bg-destructive" : "bg-primary")} style={{ width: `${(s.durationMs / max) * 100}%` }} />
                      </div>
                      <span className="text-right font-mono text-muted-foreground">{s.durationMs}ms</span>
                    </div>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
