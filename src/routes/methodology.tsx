import { createFileRoute } from "@tanstack/react-router";
import { LOOKBACK_MIN, MIN_CONFIDENT_SCORE, MIN_SUPPORTING_SIGNALS, WEIGHTS } from "@/lib/analysis/engine";

export const Route = createFileRoute("/methodology")({
  head: () => ({
    meta: [
      { title: "Methodology & setup · Incident Root Cause Analysis" },
      { name: "description", content: "How candidate root causes are scored, and how to plug in your own analysis engine." },
      { property: "og:title", content: "Methodology & setup · Incident Root Cause Analysis" },
      { property: "og:description", content: "How candidate root causes are scored, and how to plug in your own analysis engine." },
    ],
  }),
  component: Methodology,
});

const signals = [
  ["temporal", "Timing", `1 − minutes_before_onset / ${LOOKBACK_MIN}. Changes after onset score 0 overall.`],
  ["dependency", "Dependency path", "1 if the change is on the affected service, 1 − 0.2·hops if upstream, 0 if unrelated (total score then × 0.5)."],
  ["logs", "Log correlation", "ERROR/WARN lines after the change that mention its keywords or come from its service (5+ lines = 1)."],
  ["metrics", "Metric anomaly", "Peak of the changed service's metrics vs baseline; ≥1.5× counts, (ratio − 1)/3 capped at 1."],
  ["traces", "Trace bottleneck", "Share of traces in the window where the service is the slowest or erroring span."],
] as const;

function Methodology() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Methodology & setup</h1>
        <p className="text-sm text-muted-foreground">Explainable, evidence-based scoring. No paid APIs, no invented evidence, read-only.</p>
      </div>

      <section className="panel overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border"><th className="p-3">Signal</th><th className="p-3">Weight</th><th className="p-3">Rule</th></tr>
          </thead>
          <tbody>
            {signals.map(([k, label, rule]) => (
              <tr key={k} className="border-b border-border/50">
                <td className="p-3 font-medium">{label}</td>
                <td className="p-3 font-mono">{WEIGHTS[k]}</td>
                <td className="p-3 text-muted-foreground">{rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel space-y-2 p-5 text-sm">
        <h2 className="font-semibold">Verdicts</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li><b className="text-foreground">Hypothesis</b> — every engine-ranked candidate. Ranking is never proof.</li>
          <li><b className="text-foreground">Confirmed root cause</b> — only when a human records a confirmation (e.g. postmortem).</li>
          <li>
            <b className="text-warning">Insufficient evidence</b> — top score below {MIN_CONFIDENT_SCORE * 100}% or fewer than {MIN_SUPPORTING_SIGNALS} non-zero signals, or no changes recorded.
          </li>
        </ul>
      </section>

      <section className="panel space-y-3 p-5 text-sm">
        <h2 className="font-semibold">Plugging in your Python engine</h2>
        <p className="text-muted-foreground">Set <code className="font-mono text-primary">VITE_ANALYSIS_API_URL</code> and expose three read-only endpoints returning the JSON shapes in <code className="font-mono">src/lib/analysis/types.ts</code>:</p>
        <pre className="overflow-x-auto rounded-md bg-background p-3 font-mono text-xs">{`GET /incidents                 -> Incident[]
GET /incidents/{id}            -> Incident
GET /incidents/{id}/analysis   -> AnalysisResult`}</pre>
        <p className="text-muted-foreground">See the project README for a FastAPI example, testing steps and deployment.</p>
      </section>
    </div>
  );
}
