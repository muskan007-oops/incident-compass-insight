import type { AnalysisResult, Incident } from "./analysis/types";

export interface TimelineEvent {
  ts: string;
  kind: "change" | "log" | "incident";
  service: string;
  severity: string;
  description: string;
  refId: string;
}

export function buildTimeline(incident: Incident): TimelineEvent[] {
  const ev: TimelineEvent[] = [
    ...incident.changes.map((c) => ({ ts: c.ts, kind: "change" as const, service: c.service, severity: c.type, description: c.description, refId: c.id })),
    ...incident.logs
      .filter((l) => l.level !== "INFO")
      .map((l) => ({ ts: l.ts, kind: "log" as const, service: l.service, severity: l.level, description: l.message, refId: l.id })),
    { ts: incident.startedAt, kind: "incident", service: incident.affectedService, severity: incident.severity, description: "Impact onset", refId: incident.id },
    { ts: incident.detectedAt, kind: "incident", service: incident.affectedService, severity: incident.severity, description: "Alert fired / incident declared", refId: incident.id },
  ];
  if (incident.resolvedAt)
    ev.push({ ts: incident.resolvedAt, kind: "incident", service: incident.affectedService, severity: incident.severity, description: "Resolved", refId: incident.id });
  return ev.sort((a, b) => a.ts.localeCompare(b.ts));
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) => r.map((c) => { const s = String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))
    .join("\n");
}

export function timelineCsv(incident: Incident) {
  return toCsv([
    ["timestamp", "kind", "service", "severity", "description", "ref_id"],
    ...buildTimeline(incident).map((e) => [e.ts, e.kind, e.service, e.severity, e.description, e.refId]),
  ]);
}

export function findingsCsv(incident: Incident, a: AnalysisResult) {
  const rows: (string | number)[][] = [
    ["incident_id", "rank", "change_id", "service", "description", "status", "score", "confidence", "signal", "signal_score", "weight", "explanation", "evidence_ids"],
  ];
  a.candidates.forEach((c, i) =>
    c.signals.forEach((s) =>
      rows.push([incident.id, i + 1, c.changeId, c.service, c.title, c.isConfirmed ? "CONFIRMED" : "HYPOTHESIS", c.score, c.confidence, s.label, s.score.toFixed(3), s.weight, s.explanation, s.evidenceIds.join(" ")]),
    ),
  );
  rows.push([incident.id, "", "", "", "VERDICT", a.verdict === "insufficient_evidence" ? "INSUFFICIENT_EVIDENCE" : "CANDIDATES", "", "", "", "", "", a.verdictReason, ""]);
  return toCsv(rows);
}

export function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
