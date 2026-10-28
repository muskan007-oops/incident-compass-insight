import type {
  AnalysisResult,
  CandidateCause,
  ChangeEvent,
  Incident,
  SignalScore,
} from "./types";

/**
 * Explainable, deterministic root-cause ranking.
 * Every candidate is a recorded change event; every score is derived only from
 * evidence present in the incident. Nothing is invented and nothing is modified.
 */
export const WEIGHTS = {
  temporal: 0.25,
  dependency: 0.2,
  logs: 0.2,
  metrics: 0.2,
  traces: 0.15,
} as const;

export const LOOKBACK_MIN = 60; // changes older than this before onset score 0 on timing
export const MIN_CONFIDENT_SCORE = 0.45;
export const MIN_SUPPORTING_SIGNALS = 3;

const ms = (iso: string) => new Date(iso).getTime();
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Distance (in hops) from `from` to `target` following dependsOn edges, or -1. */
export function dependencyDistance(incident: Incident, from: string, target: string): number {
  if (from === target) return 0;
  const map = new Map(incident.services.map((s) => [s.name, s.dependsOn]));
  const seen = new Set([from]);
  let frontier = [from];
  for (let depth = 1; frontier.length && depth < 10; depth++) {
    const next: string[] = [];
    for (const s of frontier)
      for (const d of map.get(s) ?? []) {
        if (d === target) return depth;
        if (!seen.has(d)) {
          seen.add(d);
          next.push(d);
        }
      }
    frontier = next;
  }
  return -1;
}

function scoreChange(incident: Incident, change: ChangeEvent): CandidateCause {
  const onset = ms(incident.startedAt);
  const changeTs = ms(change.ts);
  const windowEnd = onset + 30 * 60_000;
  const signals: SignalScore[] = [];

  // 1. Temporal proximity
  const minutesBefore = (onset - changeTs) / 60_000;
  const temporal = minutesBefore < 0 ? 0 : clamp(1 - minutesBefore / LOOKBACK_MIN);
  signals.push({
    key: "temporal",
    label: "Timing",
    weight: WEIGHTS.temporal,
    score: temporal,
    explanation:
      minutesBefore < 0
        ? `Change happened ${Math.abs(minutesBefore).toFixed(0)} min after onset — cannot be the trigger.`
        : `Change landed ${minutesBefore.toFixed(0)} min before onset (window ${LOOKBACK_MIN} min).`,
    evidenceIds: [change.id],
  });

  // 2. Dependency path
  const hops = dependencyDistance(incident, incident.affectedService, change.service);
  const dependency = hops < 0 ? 0 : hops === 0 ? 1 : clamp(1 - 0.2 * hops);
  signals.push({
    key: "dependency",
    label: "Dependency path",
    weight: WEIGHTS.dependency,
    score: dependency,
    explanation:
      hops < 0
        ? `${change.service} is not on the dependency path of ${incident.affectedService}.`
        : hops === 0
          ? `Change is on the affected service itself.`
          : `${incident.affectedService} depends on ${change.service} (${hops} hop${hops > 1 ? "s" : ""}).`,
    evidenceIds: [],
  });

  // 3. Logs: errors/warnings after the change from that service or mentioning its keywords
  const kw = change.keywords.map((k) => k.toLowerCase());
  const matchedLogs = incident.logs.filter((l) => {
    const t = ms(l.ts);
    if (t < changeTs || t > windowEnd || l.level === "INFO") return false;
    const msg = l.message.toLowerCase();
    return kw.some((k) => msg.includes(k)) || (l.service === change.service && l.level === "ERROR");
  });
  const logs = clamp(matchedLogs.length / 5);
  signals.push({
    key: "logs",
    label: "Log correlation",
    weight: WEIGHTS.logs,
    score: logs,
    explanation: matchedLogs.length
      ? `${matchedLogs.length} error/warn log line(s) after the change reference ${change.service} or its keywords.`
      : `No error/warn logs after the change reference ${change.service} or its keywords.`,
    evidenceIds: matchedLogs.map((l) => l.id),
  });

  // 4. Metrics: anomaly on the changed service after the change
  let bestRatio = 0;
  const anomalous: string[] = [];
  for (const m of incident.metrics.filter((m) => m.service === change.service)) {
    const after = m.points.filter((p) => ms(p.ts) >= changeTs && ms(p.ts) <= windowEnd);
    const peak = Math.max(0, ...after.map((p) => p.value));
    const ratio = m.baseline > 0 ? peak / m.baseline : 0;
    if (ratio >= 1.5) anomalous.push(m.id);
    bestRatio = Math.max(bestRatio, ratio);
  }
  const metrics = anomalous.length ? clamp((bestRatio - 1) / 3) : 0;
  signals.push({
    key: "metrics",
    label: "Metric anomaly",
    weight: WEIGHTS.metrics,
    score: metrics,
    explanation: anomalous.length
      ? `${change.service} metrics peaked at ${bestRatio.toFixed(1)}× baseline after the change.`
      : `No metric on ${change.service} exceeded 1.5× baseline after the change.`,
    evidenceIds: anomalous,
  });

  // 5. Traces: share of traces where this service is the slowest or erroring span
  const windowTraces = incident.traces.filter((t) => ms(t.ts) >= changeTs && ms(t.ts) <= windowEnd);
  const blamed = windowTraces.filter((t) => {
    const slowest = [...t.spans].sort((a, b) => b.durationMs - a.durationMs)[0];
    return (
      slowest?.service === change.service ||
      t.spans.some((s) => s.service === change.service && s.status === "error")
    );
  });
  const traces = windowTraces.length ? clamp(blamed.length / windowTraces.length) : 0;
  signals.push({
    key: "traces",
    label: "Trace bottleneck",
    weight: WEIGHTS.traces,
    score: traces,
    explanation: windowTraces.length
      ? `${blamed.length}/${windowTraces.length} traces in window show ${change.service} as slowest or failing span.`
      : `No traces captured in the window.`,
    evidenceIds: blamed.map((t) => t.traceId),
  });

  // Timing gate: a change after onset cannot be the trigger.
  const raw = signals.reduce((s, x) => s + x.weight * x.score, 0);
  const score = temporal === 0 ? 0 : Number(raw.toFixed(3));
  const confidence = score >= 0.7 ? "high" : score >= MIN_CONFIDENT_SCORE ? "medium" : "low";

  return {
    changeId: change.id,
    service: change.service,
    title: change.description,
    score,
    confidence,
    signals,
    isConfirmed: incident.confirmedRootCause?.changeId === change.id,
  };
}

export function analyzeIncident(incident: Incident, topN = 3): AnalysisResult {
  const ranked = incident.changes
    .map((c) => scoreChange(incident, c))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const top = ranked[0];
  const supporting = top ? top.signals.filter((s) => s.score > 0).length : 0;
  let verdict: AnalysisResult["verdict"] = "candidates";
  let verdictReason = "Top candidate meets the score and evidence thresholds.";

  if (!top) {
    verdict = "insufficient_evidence";
    verdictReason = "No change events were recorded for this incident window.";
  } else if (top.score < MIN_CONFIDENT_SCORE) {
    verdict = "insufficient_evidence";
    verdictReason = `Best candidate scored ${(top.score * 100).toFixed(0)}%, below the ${MIN_CONFIDENT_SCORE * 100}% threshold.`;
  } else if (supporting < MIN_SUPPORTING_SIGNALS) {
    verdict = "insufficient_evidence";
    verdictReason = `Best candidate is backed by only ${supporting} independent signal(s); ${MIN_SUPPORTING_SIGNALS} required.`;
  }

  return {
    incidentId: incident.id,
    candidates: ranked,
    verdict,
    verdictReason,
    engine: "builtin-ts v1 (weighted evidence scoring)",
  };
}
