import { beforeEach, describe, expect, it } from "vitest";
import { addIncidentToState, addLogToState, getIncidentState, SAMPLE_INCIDENTS } from "./sample-incidents";

describe("incident state", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
  });

  it("uses the bundled incidents until browser state is written", () => {
    expect(getIncidentState()).toEqual(SAMPLE_INCIDENTS);
  });

  it("persists newly ingested incidents", () => {
    const incident = { ...SAMPLE_INCIDENTS[0]!, id: "INC-LIVE-1", title: "Live incident" };

    const updated = addIncidentToState(incident);

    expect(updated[0]).toEqual(incident);
    expect(getIncidentState()[0]).toEqual(incident);
  });

  it("attaches and persists live logs on the selected incident", () => {
    const log = {
      id: "live-log-1",
      ts: "2026-10-29T12:00:00.000Z",
      service: "notifications-worker",
      level: "ERROR" as const,
      message: "Email delivery timed out",
    };

    const updated = addLogToState(SAMPLE_INCIDENTS[0]!.id, log);
    const incident = updated.find((item) => item.id === SAMPLE_INCIDENTS[0]!.id)!;

    expect(incident.logs).toContainEqual(log);
    expect(getIncidentState().find((item) => item.id === incident.id)?.logs).toContainEqual(log);
  });
});