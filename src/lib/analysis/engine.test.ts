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

  it("reports insufficient evidence for INC-2043", () => {
    expect(analyzeIncident(get("INC-2043")).verdict).toBe("insufficient_evidence");
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
