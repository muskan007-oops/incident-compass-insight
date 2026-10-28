// SAMPLE DATA ONLY — fictional but realistic. Replace via src/lib/data-source.ts.
import type { Incident, LogEntry, MetricSeries, Trace } from "@/lib/analysis/types";

const at = (base: string, min: number) => new Date(new Date(base).getTime() + min * 60_000).toISOString();

/** Builds a minute-resolution series from -40 to +40 min around `base`. */
function series(
  id: string,
  base: string,
  service: string,
  metric: string,
  unit: string,
  baseline: number,
  shape: (m: number) => number,
  withJitter = true,
): MetricSeries {
  const points = [];
  for (let m = -40; m <= 40; m += 2) {
    const jitter = withJitter ? 1 + Math.sin(m * 1.7 + id.length) * 0.04 : 1;
    points.push({ ts: at(base, m), value: Number((shape(m) * jitter).toFixed(2)) });
  }
  return { id, service, metric, unit, baseline, points };
}

const step = (from: number, to: number, start: number, ramp = 4) => (m: number) =>
  m < start ? from : m < start + ramp ? from + ((to - from) * (m - start)) / ramp : to;

function logs(base: string, rows: [number, string, LogEntry["level"], string, string?][], prefix: string): LogEntry[] {
  return rows.map(([min, service, level, message, traceId], i) => ({
    id: `${prefix}-log-${i + 1}`,
    ts: at(base, min),
    service,
    level,
    message,
    ...(traceId ? { traceId } : {}),
  }));
}

function traces(base: string, prefix: string, rows: [number, string, [string, string, number, ("ok" | "error")?][]][]): Trace[] {
  return rows.map(([min, root, spans], i) => ({
    traceId: `${prefix}-tr-${(i + 1).toString().padStart(3, "0")}`,
    ts: at(base, min),
    rootService: root,
    spans: spans.map(([service, operation, durationMs, status]) => ({ service, operation, durationMs, status: status ?? "ok" })),
  }));
}

// ---------- INC-2041: Checkout latency (confirmed root cause) ----------
const B1 = "2026-10-27T14:00:00.000Z";
const inc1: Incident = {
  id: "INC-2041",
  title: "Checkout p99 latency spike and payment timeouts",
  severity: "SEV1",
  status: "resolved",
  affectedService: "checkout-api",
  startedAt: B1,
  detectedAt: at(B1, 4),
  resolvedAt: at(B1, 38),
  latencyP99Ms: 4820,
  baselineLatencyMs: 340,
  errorRate: 12.4,
  baselineErrorRate: 0.3,
  summary: "Customers saw checkout spinners and 504s. Payment authorisation calls timed out.",
  services: [
    { name: "web-frontend", dependsOn: ["checkout-api"] },
    { name: "checkout-api", dependsOn: ["payments-service", "inventory-service", "redis-cache"] },
    { name: "payments-service", dependsOn: ["payments-db"] },
    { name: "inventory-service", dependsOn: ["inventory-db"] },
    { name: "payments-db", dependsOn: [] },
    { name: "inventory-db", dependsOn: [] },
    { name: "redis-cache", dependsOn: [] },
  ],
  changes: [
    { id: "CHG-881", ts: at(B1, -7), service: "payments-service", type: "config", author: "r.mehta", description: "Reduced payments DB connection pool max_pool_size 50 → 5", keywords: ["pool", "connection", "max_pool_size"] },
    { id: "CHG-879", ts: at(B1, -28), service: "web-frontend", type: "deploy", author: "ci-bot", description: "Deploy web-frontend v4.12.0 (new cart UI)", keywords: ["cart-ui", "v4.12.0"] },
    { id: "CHG-880", ts: at(B1, -15), service: "inventory-service", type: "feature_flag", author: "a.khan", description: "Enabled flag inventory.reservation_v2 for 10% traffic", keywords: ["reservation_v2"] },
    { id: "CHG-884", ts: at(B1, 12), service: "payments-service", type: "config", author: "oncall", description: "Rollback max_pool_size 5 → 50 (mitigation)", keywords: ["rollback"] },
  ],
  logs: logs(B1, [
    [-27, "web-frontend", "INFO", "Deployment v4.12.0 healthy, 6/6 pods ready"],
    [-15, "inventory-service", "INFO", "Feature flag reservation_v2 evaluated: enabled for 10%"],
    [-7, "payments-service", "INFO", "Config reload: max_pool_size=5"],
    [-2, "payments-service", "WARN", "Connection pool saturation 5/5 active, 42 waiting", "c1-tr-001"],
    [0, "payments-service", "ERROR", "Timeout acquiring connection from pool after 3000ms", "c1-tr-002"],
    [1, "checkout-api", "ERROR", "Upstream payments-service timed out (POST /authorize)", "c1-tr-002"],
    [2, "payments-service", "ERROR", "Timeout acquiring connection from pool after 3000ms", "c1-tr-003"],
    [3, "checkout-api", "WARN", "Circuit breaker half-open for payments-service"],
    [3, "inventory-service", "WARN", "reservation_v2 slow path taken (212ms)"],
    [5, "payments-service", "ERROR", "HikariPool-1 - Connection is not available, request timed out", "c1-tr-004"],
    [6, "web-frontend", "WARN", "Checkout request exceeded 4s client budget"],
    [8, "checkout-api", "ERROR", "504 Gateway Timeout returned to client", "c1-tr-005"],
    [12, "payments-service", "INFO", "Config reload: max_pool_size=50"],
    [18, "payments-service", "INFO", "Pool healthy: 11/50 active, 0 waiting"],
  ], "c1"),
  metrics: [
    series("c1-m-lat", B1, "checkout-api", "p99 latency", "ms", 340, (m) => (m < 0 ? 340 : m < 14 ? 4800 : m < 22 ? 900 : 360)),
    series("c1-m-err", B1, "checkout-api", "error rate", "%", 0.3, (m) => (m < 0 ? 0.3 : m < 14 ? 12.4 : m < 22 ? 2 : 0.4)),
    series("c1-m-pool", B1, "payments-service", "pool wait time", "ms", 4, (m) => (m < -6 ? 4 : m < 13 ? 2900 : 6)),
    series("c1-m-inv", B1, "inventory-service", "p99 latency", "ms", 180, (m) => (m < -14 ? 180 : 215)),
    series("c1-m-fe", B1, "web-frontend", "p99 latency", "ms", 600, step(600, 5100, 0, 2)),
  ],
  traces: traces(B1, "c1", [
    [-2, "checkout-api", [["checkout-api", "POST /checkout", 3400], ["payments-service", "authorize", 3200], ["inventory-service", "reserve", 190]]],
    [0, "checkout-api", [["checkout-api", "POST /checkout", 4100], ["payments-service", "authorize", 3990, "error"], ["inventory-service", "reserve", 205]]],
    [2, "checkout-api", [["checkout-api", "POST /checkout", 4300], ["payments-service", "authorize", 4100, "error"], ["inventory-service", "reserve", 210]]],
    [5, "checkout-api", [["checkout-api", "POST /checkout", 4800], ["payments-service", "authorize", 4600, "error"], ["redis-cache", "get", 2]]],
    [8, "checkout-api", [["checkout-api", "POST /checkout", 5000, "error"], ["payments-service", "authorize", 4900, "error"], ["inventory-service", "reserve", 212]]],
    [9, "checkout-api", [["checkout-api", "POST /checkout", 820], ["inventory-service", "reserve", 640], ["payments-service", "authorize", 120]]],
  ]),
  confirmedRootCause: {
    changeId: "CHG-881",
    confirmedBy: "Payments team postmortem PM-112",
    confirmedAt: at(B1, 60 * 24),
    note: "Pool size typo (5 instead of 50) in config PR. Rollback restored service.",
  },
};

// ---------- INC-2042: Auth errors (candidate hypothesis, unconfirmed) ----------
const B2 = "2026-10-28T09:20:00.000Z";
const inc2: Incident = {
  id: "INC-2042",
  title: "Elevated 401s on login and token refresh",
  severity: "SEV2",
  status: "investigating",
  affectedService: "auth-gateway",
  startedAt: B2,
  detectedAt: at(B2, 6),
  latencyP99Ms: 910,
  baselineLatencyMs: 220,
  errorRate: 7.8,
  baselineErrorRate: 0.5,
  summary: "Mobile users are logged out unexpectedly; refresh tokens rejected intermittently.",
  services: [
    { name: "mobile-bff", dependsOn: ["auth-gateway"] },
    { name: "auth-gateway", dependsOn: ["token-service", "user-profile"] },
    { name: "token-service", dependsOn: ["session-redis", "kms"] },
    { name: "user-profile", dependsOn: ["profile-db"] },
    { name: "session-redis", dependsOn: [] },
    { name: "kms", dependsOn: [] },
    { name: "profile-db", dependsOn: [] },
  ],
  changes: [
    { id: "CHG-902", ts: at(B2, -11), service: "session-redis", type: "infra", author: "platform", description: "Redis cluster failover to replica set B (maintenance)", keywords: ["redis", "failover", "moved"] },
    { id: "CHG-901", ts: at(B2, -35), service: "token-service", type: "deploy", author: "ci-bot", description: "Deploy token-service v2.8.1 (JWT library bump)", keywords: ["jwt", "signature"] },
    { id: "CHG-903", ts: at(B2, -50), service: "user-profile", type: "deploy", author: "ci-bot", description: "Deploy user-profile v1.30.0", keywords: ["avatar"] },
  ],
  logs: logs(B2, [
    [-35, "token-service", "INFO", "Started token-service v2.8.1"],
    [-11, "session-redis", "INFO", "Failover initiated: promoting replica set B"],
    [-9, "session-redis", "WARN", "Replica set B lagging 3.4s behind primary"],
    [-1, "token-service", "WARN", "Redis MOVED redirection storm, retrying", "a2-tr-001"],
    [0, "token-service", "ERROR", "Refresh token not found in session store (redis)", "a2-tr-002"],
    [1, "auth-gateway", "ERROR", "token-service returned 401 for /refresh", "a2-tr-002"],
    [3, "token-service", "WARN", "JWT signature validated with fallback key"],
    [4, "mobile-bff", "WARN", "Forced logout for 312 sessions in last minute"],
    [6, "token-service", "ERROR", "Refresh token not found in session store (redis)", "a2-tr-003"],
    [9, "auth-gateway", "ERROR", "Login failed: session write timeout", "a2-tr-004"],
  ], "a2"),
  metrics: [
    series("a2-m-err", B2, "auth-gateway", "error rate", "%", 0.5, step(0.5, 7.8, 0, 3)),
    series("a2-m-lat", B2, "auth-gateway", "p99 latency", "ms", 220, step(220, 910, 0, 3)),
    series("a2-m-miss", B2, "session-redis", "cache miss rate", "%", 2, step(2, 9.5, -9, 6)),
    series("a2-m-tok", B2, "token-service", "p99 latency", "ms", 90, step(90, 160, -2, 4)),
  ],
  traces: traces(B2, "a2", [
    [-1, "auth-gateway", [["auth-gateway", "POST /refresh", 700], ["token-service", "refresh", 640], ["session-redis", "GET", 580]]],
    [0, "auth-gateway", [["auth-gateway", "POST /refresh", 820, "error"], ["token-service", "refresh", 760, "error"], ["session-redis", "GET", 690]]],
    [6, "auth-gateway", [["auth-gateway", "POST /refresh", 650, "error"], ["token-service", "refresh", 600, "error"], ["session-redis", "GET", 120]]],
    [9, "auth-gateway", [["auth-gateway", "POST /login", 910, "error"], ["user-profile", "get", 80], ["session-redis", "SET", 850, "error"]]],
  ]),
};

// ---------- INC-2043: Search 502s (candidate hypothesis on dependency path) ----------
const B3 = "2026-10-28T10:05:00.000Z";
const inc3: Incident = {
  id: "INC-2043",
  title: "Intermittent 502s on product search",
  severity: "SEV3",
  status: "investigating",
  affectedService: "search-api",
  startedAt: B3,
  detectedAt: at(B3, 6),
  latencyP99Ms: 640,
  baselineLatencyMs: 410,
  errorRate: 1.9,
  baselineErrorRate: 0.4,
  summary: "Sample scenario: sporadic 502s on search. search-index started rejecting requests shortly after a thread-pool config change.",
  services: [
    { name: "search-api", dependsOn: ["search-index", "ranking-ml"] },
    { name: "search-index", dependsOn: [] },
    { name: "ranking-ml", dependsOn: [] },
    { name: "marketing-site", dependsOn: [] },
  ],
  changes: [
    { id: "CHG-912", ts: at(B3, -6), service: "search-index", type: "config", author: "s.iyer", description: "Lowered search-index thread_pool.search.size 16 → 4", keywords: ["thread_pool", "rejected execution"] },
    { id: "CHG-910", ts: at(B3, -4), service: "marketing-site", type: "deploy", author: "ci-bot", description: "Deploy marketing-site banner v18", keywords: ["banner"] },
    { id: "CHG-911", ts: at(B3, 9), service: "ranking-ml", type: "config", author: "ml-ops", description: "Raised ranking-ml replica count 4 → 6", keywords: ["replica"] },
  ],
  logs: logs(B3, [
    [-6, "search-index", "INFO", "Config reload: thread_pool.search.size=4"],
    [-4, "marketing-site", "INFO", "Deployed banner v18"],
    [-2, "search-index", "WARN", "thread_pool[search] queue 940/1000"],
    [0, "search-index", "ERROR", "rejected execution of search request: thread_pool[search] queue capacity 1000 reached", "s3-tr-001"],
    [0, "search-api", "ERROR", "502 Bad Gateway: search-index returned 429", "s3-tr-001"],
    [3, "search-index", "ERROR", "rejected execution of search request: thread_pool[search] queue capacity 1000 reached", "s3-tr-002"],
    [5, "search-api", "ERROR", "502 Bad Gateway: search-index returned 429", "s3-tr-003"],
    [9, "ranking-ml", "INFO", "Scaled to 6 replicas"],
    [12, "search-api", "ERROR", "502 Bad Gateway: search-index returned 429", "s3-tr-004"],
  ], "s3"),
  metrics: [
    // search-api series use no jitter so charts match the 640 ms / 1.9% headline values exactly.
    series("s3-m-err", B3, "search-api", "error rate", "%", 0.4, step(0.4, 1.9, 0, 2), false),
    series("s3-m-lat", B3, "search-api", "p99 latency", "ms", 410, step(410, 640, 0, 2), false),
    series("s3-m-rej", B3, "search-index", "rejected requests", "/min", 1, step(1, 140, -2, 3)),
    series("s3-m-idx", B3, "search-index", "p99 latency", "ms", 60, step(60, 590, -2, 3)),
    series("s3-m-rank", B3, "ranking-ml", "p99 latency", "ms", 45, () => 46),
  ],
  traces: traces(B3, "s3", [
    [0, "search-api", [["search-api", "GET /search", 610, "error"], ["search-index", "query", 565, "error"], ["ranking-ml", "score", 40]]],
    [3, "search-api", [["search-api", "GET /search", 625], ["search-index", "query", 580], ["ranking-ml", "score", 44]]],
    [5, "search-api", [["search-api", "GET /search", 632, "error"], ["search-index", "query", 588, "error"], ["ranking-ml", "score", 42]]],
    [12, "search-api", [["search-api", "GET /search", 640, "error"], ["search-index", "query", 594, "error"], ["ranking-ml", "score", 41]]],
  ]),
};

// ---------- INC-2044: Notification delays (insufficient evidence) ----------
const B4 = "2026-10-28T10:40:00.000Z";
const inc4: Incident = {
  id: "INC-2044",
  title: "Delayed order notification emails",
  severity: "SEV3",
  status: "investigating",
  affectedService: "notifications-worker",
  startedAt: B4,
  detectedAt: at(B4, 15),
  latencyP99Ms: 2100,
  baselineLatencyMs: 650,
  errorRate: 0.6,
  baselineErrorRate: 0.2,
  summary: "Order emails arrive minutes late. No recorded change on the notification path explains it yet.",
  services: [
    { name: "notifications-worker", dependsOn: ["email-provider", "sms-gateway"] },
    { name: "email-provider", dependsOn: [] },
    { name: "sms-gateway", dependsOn: [] },
    { name: "billing-service", dependsOn: [] },
  ],
  changes: [
    { id: "CHG-920", ts: at(B4, -20), service: "billing-service", type: "deploy", author: "ci-bot", description: "Deploy billing-service v3.4.2 (invoice PDF fonts)", keywords: ["invoice"] },
  ],
  logs: logs(B4, [
    [-20, "billing-service", "INFO", "Started billing-service v3.4.2"],
    [2, "notifications-worker", "WARN", "email-provider responded in 2.1s (send)"],
    [9, "notifications-worker", "WARN", "Send queue depth 1840 messages"],
  ], "n4"),
  metrics: [
    series("n4-m-lat", B4, "notifications-worker", "p99 send latency", "ms", 650, step(650, 2100, 0, 6)),
    series("n4-m-err", B4, "notifications-worker", "error rate", "%", 0.2, step(0.2, 0.6, 0, 6)),
  ],
  traces: [],
};

export const SAMPLE_INCIDENTS: Incident[] = [inc4, inc3, inc2, inc1];
