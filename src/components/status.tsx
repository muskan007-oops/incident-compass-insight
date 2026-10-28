import type { IncidentStatus, LogLevel, Severity } from "@/lib/analysis/types";
import { cn } from "@/lib/utils";

const sevClass: Record<Severity, string> = {
  SEV1: "bg-destructive/15 text-destructive border-destructive/40",
  SEV2: "bg-warning/15 text-warning border-warning/40",
  SEV3: "bg-info/15 text-info border-info/40",
};
const sevDot: Record<Severity, string> = { SEV1: "bg-destructive", SEV2: "bg-warning", SEV3: "bg-info" };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium", sevClass[severity])}>{severity}</span>;
}

export function SeverityDot({ severity }: { severity: Severity }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", sevDot[severity])} />;
}

const statusClass: Record<IncidentStatus, string> = {
  investigating: "text-warning",
  mitigated: "text-info",
  resolved: "text-success",
};

export function StatusPill({ status }: { status: IncidentStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium capitalize", statusClass[status])}>
      <span className={cn("size-1.5 rounded-full bg-current", status === "investigating" && "animate-pulse")} />
      {status}
    </span>
  );
}

const levelClass: Record<LogLevel, string> = {
  ERROR: "text-destructive",
  WARN: "text-warning",
  INFO: "text-muted-foreground",
};
export function LevelTag({ level }: { level: LogLevel }) {
  return <span className={cn("font-mono text-[11px] font-semibold", levelClass[level])}>{level}</span>;
}

export function HypothesisBadge({ confirmed }: { confirmed: boolean }) {
  return confirmed ? (
    <span className="rounded border border-success/50 bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
      Confirmed root cause
    </span>
  ) : (
    <span className="rounded border border-dashed border-muted-foreground/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      Hypothesis
    </span>
  );
}

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
