import { describe, expect, it } from "vitest";
import { SAMPLE_INCIDENTS } from "@/data/sample-incidents";
import { analyzeIncident, dependencyDistance } from "./engine";
import { findingsCsv } from "../export";

const get = (id: string) => SAMPLE_INCIDENTS.find((i) => i.id === id)!;

describe("root cause engine", () => {
  it("ranks the pool-size config change first for INC-2041", () => {
    const r = analyzeIncident(get("INC-2041"));
    expect(r.verdict).toBe("candidates");
    expect(r.candidates[0]?.changeId).toBe("CHG-881");
  });

  it("returns at most three candidates", () => {
    expect(analyzeIncident(get("INC-2041")).candidates.length).toBe(3);
  });

  it("only marks a cause confirmed when a human confirmation exists", () => {
    expect(analyzeIncident(get("INC-2041")).candidates[0]?.isConfirmed).toBe(true);
    expect(analyzeIncident(get("INC-2042")).candidates.every((c) => !c.isConfirmed)).toBe(true);
  });

  it("scores changes made after impact onset as zero", () => {
    const c = analyzeIncident(get("INC-2041"), 10).candidates.find((c) => c.changeId === "CHG-884")!;
    expect(c.score).toBe(0);
  });

  it("case 1 — expected candidate ranks first: INC-2043 ranks the search-index thread-pool change first", () => {
    const r = analyzeIncident(get("INC-2043"));
    expect(r.verdict).toBe("candidates");
    expect(r.candidates[0]?.changeId).toBe("CHG-912");
    expect(r.candidates[0]?.isConfirmed).toBe(false);
  });

  it("case 2 — unrelated change ranks lower: marketing-site deploy (closer in time) ranks below CHG-912", () => {
    const r = analyzeIncident(get("INC-2043"));
    const ids = r.candidates.map((c) => c.changeId);
    const unrelated = r.candidates.find((c) => c.changeId === "CHG-910")!;
    expect(ids.indexOf("CHG-910")).toBeGreaterThan(ids.indexOf("CHG-912"));
    expect(unrelated.signals.find((s) => s.key === "dependency")?.score).toBe(0);
    expect(unrelated.score).toBeLessThan(0.45);
  });

  it("case 3 — cause remains unknown: INC-2044 reports insufficient evidence", () => {
    const r = analyzeIncident(get("INC-2044"));
    expect(r.verdict).toBe("insufficient_evidence");
    expect(r.candidates.every((c) => !c.isConfirmed)).toBe(true);
  });

  it("only cites evidence ids that exist in the incident", () => {
    for (const inc of SAMPLE_INCIDENTS) {
      const known = new Set([...inc.logs.map((l) => l.id), ...inc.metrics.map((m) => m.id), ...inc.traces.map((t) => t.traceId), ...inc.changes.map((c) => c.id)]);
      for (const c of analyzeIncident(inc, 10).candidates)
        for (const s of c.signals) for (const id of s.evidenceIds) expect(known.has(id)).toBe(true);
    }
  });

  it("sample data is internally consistent (services, trace ids, confirmed change ids)", () => {
    for (const inc of SAMPLE_INCIDENTS) {
      const svc = new Set(inc.services.map((s) => s.name));
      const traceIds = new Set(inc.traces.map((t) => t.traceId));
      expect(svc.has(inc.affectedService)).toBe(true);
      inc.services.forEach((s) => s.dependsOn.forEach((d) => expect(svc.has(d)).toBe(true)));
      inc.changes.forEach((c) => expect(svc.has(c.service)).toBe(true));
      inc.metrics.forEach((m) => expect(svc.has(m.service)).toBe(true));
      inc.logs.forEach((l) => {
        expect(svc.has(l.service)).toBe(true);
        if (l.traceId) expect(traceIds.has(l.traceId)).toBe(true);
      });
      if (inc.confirmedRootCause) expect(inc.changes.some((c) => c.id === inc.confirmedRootCause!.changeId)).toBe(true);
      expect(inc.detectedAt >= inc.startedAt).toBe(true);
    }
  });

  it("follows dependency edges", () => {
    expect(dependencyDistance(get("INC-2042"), "auth-gateway", "session-redis")).toBe(2);
    expect(dependencyDistance(get("INC-2043"), "search-api", "marketing-site")).toBe(-1);
  });

  it("exports hypothesis vs confirmed status in findings CSV", () => {
    const i = get("INC-2042");
    const csv = findingsCsv(i, analyzeIncident(i));
    expect(csv).toContain("HYPOTHESIS");
    expect(csv).not.toContain("CONFIRMED");
  });
});
