// Shared data contract. Sample data, the in-browser engine and any external
// (e.g. Python) analysis engine must all speak these shapes.

export type Severity = "SEV1" | "SEV2" | "SEV3";
export type IncidentStatus = "investigating" | "mitigated" | "resolved";
export type LogLevel = "ERROR" | "WARN" | "INFO";
export type ChangeType = "deploy" | "config" | "feature_flag" | "infra";

export interface ServiceNode {
  name: string;
  dependsOn: string[];
}

export interface LogEntry {
  id: string;
  ts: string; // ISO
  service: string;
  level: LogLevel;
  message: string;
  traceId?: string;
}

export interface MetricSeries {
  id: string;
  service: string;
  metric: string;
  unit: string;
  baseline: number;
  points: { ts: string; value: number }[];
}

export interface TraceSpan {
  service: string;
  operation: string;
  durationMs: number;
  status: "ok" | "error";
}

export interface Trace {
  traceId: string;
  ts: string;
  rootService: string;
  spans: TraceSpan[];
}

export interface ChangeEvent {
  id: string;
  ts: string;
  service: string;
  type: ChangeType;
  author: string;
  description: string;
  /** Terms recorded in the change (config keys, module names) used to match logs. */
  keywords: string[];
}

/** Only set by a human (e.g. after postmortem). The engine never sets this. */
export interface ConfirmedRootCause {
  changeId: string;
  confirmedBy: string;
  confirmedAt: string;
  note: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  affectedService: string;
  startedAt: string;
  detectedAt: string;
  resolvedAt?: string;
  latencyP99Ms: number;
  baselineLatencyMs: number;
  errorRate: number; // percent
  baselineErrorRate: number;
  summary: string;
  services: ServiceNode[];
  logs: LogEntry[];
  metrics: MetricSeries[];
  traces: Trace[];
  changes: ChangeEvent[];
  confirmedRootCause?: ConfirmedRootCause;
}

export type SignalKey = "temporal" | "dependency" | "logs" | "metrics" | "traces";

export interface SignalScore {
  key: SignalKey;
  label: string;
  weight: number;
  score: number; // 0..1
  explanation: string;
  evidenceIds: string[]; // ids of logs / metrics / traces backing this signal
}

export interface CandidateCause {
  changeId: string;
  service: string;
  title: string;
  score: number; // 0..1 weighted
  confidence: "high" | "medium" | "low";
  signals: SignalScore[];
  isConfirmed: boolean;
  /** Gate applied after the weighted sum, if any (human-readable). */
  adjustment: string | null;
}

export interface AnalysisResult {
  incidentId: string;
  candidates: CandidateCause[]; // sorted desc, top N
  verdict: "candidates" | "insufficient_evidence";
  verdictReason: string;
  engine: string;
  /** Set by the data source when the analysis was (re)run. */
  analyzedAt?: string;
}
