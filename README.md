# AI-Based Incident Root Cause Analysis

Dark monitoring dashboard that correlates **logs, metrics, traces and change events** to rank
candidate root causes for software incidents, with explainable, evidence-based scoring.

## Technology stack

| Layer | Tech |
|---|---|
| Framework | TanStack Start v1 (React 19, SSR), Vite 7 |
| Styling | Tailwind CSS v4 (tokens in `src/styles.css`) |
| Data fetching | TanStack Query |
| Charts | Recharts |
| Tests | Vitest |
| Hosting | Edge runtime (Cloudflare Workers) via Lovable publish |

No paid API keys. The demo is fully self-contained.

## Project structure

```
src/
  data/sample-incidents.ts     # SAMPLE DATA ONLY (3 fictional incidents)
  lib/analysis/types.ts        # Data contract shared by UI, sample data and any engine
  lib/analysis/engine.ts       # Built-in scoring engine (pure, deterministic)
  lib/analysis/engine.test.ts  # Rule tests
  lib/data-source.ts           # Switch between sample data and an external engine
  lib/export.ts                # Timeline + findings CSV export
  components/                  # Shell + status indicators
  routes/                      # /, /incidents/$id, /methodology
```

Sample data is never imported by the engine; the engine only takes an `Incident` object.

## Setup

```bash
bun install        # or npm install
bun run dev        # http://localhost:8080
bun run test       # run scoring tests
bun run build      # production build
```

## Deployment

- In Lovable: click **Publish**.
- Elsewhere: `bun run build` and deploy the output to any edge/Node host supporting TanStack Start.

## Scoring (explainable)

Each recorded change event is a candidate. Score = weighted sum of five signals
(timing 0.25, dependency path 0.2, logs 0.2, metrics 0.2, traces 0.15). Each signal
stores a human-readable explanation and the IDs of the evidence it used.
- Changes after impact onset score 0.
- **Insufficient evidence** if the top score < 45%, fewer than 3 non-zero signals, or no changes.
- Rankings are always **hypotheses**. A cause is **confirmed** only when `confirmedRootCause`
  is set by a human (e.g. postmortem). The app is read-only and never touches production.

## Testing the results

1. `bun run test` — asserts INC-2041 ranks CHG-881 first, post-onset changes score 0,
   INC-2043 returns insufficient evidence, and CSV marks hypotheses correctly.
2. In the UI, open each incident, click candidates and check that every score line in
   the evidence panel points to real log lines / metrics (toggle *Evidence only* in the log explorer).
3. Export the CSVs and compare against your own postmortems (precision@1 / @3).

## Replacing sample data with your Python engine

Set `VITE_ANALYSIS_API_URL=https://your-engine.example.com` (build-time env var). The UI then calls:

```
GET /incidents               -> Incident[]
GET /incidents/{id}          -> Incident
GET /incidents/{id}/analysis -> AnalysisResult
```

Shapes are defined in `src/lib/analysis/types.ts`. Minimal FastAPI sketch:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"])

@app.get("/incidents")
def incidents(): return load_incidents()          # your log/metric/trace loaders

@app.get("/incidents/{id}")
def incident(id: str): return load_incident(id)

@app.get("/incidents/{id}/analysis")
def analysis(id: str):
    inc = load_incident(id)
    return {"incidentId": id, "candidates": rank(inc), "verdict": "candidates",
            "verdictReason": "...", "engine": "python v0.1"}
```

Keep `isConfirmed` false unless a human confirmed it, and return
`"verdict": "insufficient_evidence"` rather than guessing.
