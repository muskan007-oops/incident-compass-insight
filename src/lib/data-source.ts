// Single seam between the UI and where data/analysis comes from.
// Default: bundled sample data + built-in TS engine (no API keys).
// Set VITE_ANALYSIS_API_URL to use an external engine (e.g. your Python service)
// that returns the same JSON shapes defined in ./analysis/types.ts.
import { queryOptions } from "@tanstack/react-query";
import { SAMPLE_INCIDENTS } from "@/data/sample-incidents";
import { analyzeIncident } from "./analysis/engine";
import type { AnalysisResult, Incident } from "./analysis/types";

const API = (import.meta.env.VITE_ANALYSIS_API_URL as string | undefined)?.replace(/\/$/, "");

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Analysis API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchIncidents(): Promise<Incident[]> {
  return API ? getJson<Incident[]>("/incidents") : SAMPLE_INCIDENTS;
}

export async function fetchIncident(id: string): Promise<Incident | undefined> {
  if (API) return getJson<Incident>(`/incidents/${encodeURIComponent(id)}`);
  return SAMPLE_INCIDENTS.find((i) => i.id === id);
}

export async function fetchAnalysis(incident: Incident): Promise<AnalysisResult> {
  if (API) return getJson<AnalysisResult>(`/incidents/${encodeURIComponent(incident.id)}/analysis`);
  return analyzeIncident(incident);
}

export const dataSourceLabel = API ? `External engine (${API})` : "Sample data · built-in engine";

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
