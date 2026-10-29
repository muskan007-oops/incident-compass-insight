// Single seam between the UI and where data/analysis comes from.
// Default: bundled sample data + built-in TS engine (no API keys).
// Set VITE_ANALYSIS_API_URL to use an external engine (e.g. your Python service)
// that returns the same JSON shapes defined in ./analysis/types.ts.
import { queryOptions } from "@tanstack/react-query";
import { addIncidentToState, addLogToState, getIncidentState } from "@/data/sample-incidents";
import { analyzeIncident } from "./analysis/engine";
import type { AnalysisResult, Incident, LogEntry } from "./analysis/types";

const API = (import.meta.env["VITE_ANALYSIS_API_URL"] as string | undefined)?.replace(/\/$/, "");

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Analysis API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson(path: string, payload: unknown): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Analysis API ${path} failed: ${res.status}`);
}

export async function fetchIncidents(): Promise<Incident[]> {
  return API ? getJson<Incident[]>("/incidents") : getIncidentState();
}

export async function fetchIncident(id: string): Promise<Incident | undefined> {
  if (API) return getJson<Incident>(`/incidents/${encodeURIComponent(id)}`);
  return getIncidentState().find((i) => i.id === id);
}

export async function ingestIncident(incident: Incident): Promise<void> {
  if (API) return postJson("/incidents", incident);
  addIncidentToState(incident);
}

export async function ingestLog(incidentId: string, log: LogEntry): Promise<void> {
  if (API) return postJson(`/incidents/${encodeURIComponent(incidentId)}/logs`, log);
  addLogToState(incidentId, log);
}

export async function fetchAnalysis(incident: Incident): Promise<AnalysisResult> {
  const result = API
    ? await getJson<AnalysisResult>(`/incidents/${encodeURIComponent(incident.id)}/analysis`)
    : analyzeIncident(incident);
  return { ...result, analyzedAt: new Date().toISOString() };
}

export const dataSourceLabel = API ? `External engine (${API})` : "Browser storage · built-in engine";

export const incidentsQuery = () =>
  queryOptions({ queryKey: ["incidents"], queryFn: fetchIncidents });

export const incidentQuery = (id: string) =>
  queryOptions({
    queryKey: ["incident", id],
    queryFn: async () => {
      const incident = await fetchIncident(id);
      if (!incident) return null;
      return { incident, analysis: await fetchAnalysis(incident) };
    },
  });

export const overviewQuery = () =>
  queryOptions({
    queryKey: ["overview"],
    queryFn: async () => {
      const incidents = await fetchIncidents();
      return Promise.all(incidents.map(async (incident) => ({ incident, analysis: await fetchAnalysis(incident) })));
    },
  });
