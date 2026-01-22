// src/metrics.js (CommonJS)
// 목적: Node.js 업스트림 병목(이벤트루프/GC/CPU/메모리)을 관측하기 위한 /metrics
// 보안 원칙:
// - 기본 OFF (METRICS_ENABLED=1 일 때만 켜짐)
// - 기본 loopback(127.0.0.1) 바인딩
// - non-loopback 바인딩은 METRICS_ALLOW_NON_LOOPBACK=1 일 때만 허용
// - Service/Ingress/Kong에 metrics 포트/경로 추가 금지 (운영 정책)

const http = require("http");
const client = require("prom-client");
const { monitorEventLoopDelay, PerformanceObserver, constants } = require("perf_hooks");

function startMetricsServer(serviceName = "service") {
  // ✅ 기본 OFF: env로만 ON
  const enabled = (process.env.METRICS_ENABLED || "0") === "1";
  if (!enabled) return null;

  // ✅ 기본 loopback 고정
  const host = process.env.METRICS_HOST || "127.0.0.1";
  const port = Number(process.env.METRICS_PORT || 9100);

  // ✅ non-loopback 바인딩은 명시적으로만 허용 (실수로 0.0.0.0 방지)
  const allowNonLoopback = (process.env.METRICS_ALLOW_NON_LOOPBACK || "0") === "1";
  const isLoopback = host === "127.0.0.1" || host === "localhost";

  if (!allowNonLoopback && !isLoopback) {
    console.warn(
      `[metrics][${serviceName}] blocked non-loopback host=${host} (set METRICS_ALLOW_NON_LOOPBACK=1 to override)`
    );
    return null;
  }

  // ✅ Registry를 start 시점에 생성 → METRICS_ENABLED=0이면 오버헤드 0
  const register = new client.Registry();

  // ✅ 모든 메트릭에 service 라벨 고정 (기본메트릭 + 커스텀메트릭 모두 동일하게)
  if (typeof register.setDefaultLabels === "function") {
    register.setDefaultLabels({ service: serviceName });
  }

  // ✅ 기본 메트릭 수집 (튜닝: eventLoopMonitoringPrecision)
  // - 옵션 eventLoopMonitoringPrecision은 prom-client에서 event loop lag 측정 해상도 튜닝에 사용됨 :contentReference[oaicite:1]{index=1}
  client.collectDefaultMetrics({
    register,
    eventLoopMonitoringPrecision: 20,
  });

  // --- custom: event loop lag p99, heap, rss ---
  const eventLoopLagP99Ms = new client.Gauge({
    name: "nodejs_event_loop_lag_p99_ms",
    help: "Event loop lag p99 in ms",
    registers: [register],
  });

  const heapUsedBytes = new client.Gauge({
    name: "nodejs_heap_used_bytes",
    help: "process.memoryUsage().heapUsed in bytes",
    registers: [register],
  });

  const rssBytes = new client.Gauge({
    name: "nodejs_rss_bytes",
    help: "process.memoryUsage().rss in bytes",
    registers: [register],
  });

  // event loop delay (nanoseconds)
  const h = monitorEventLoopDelay({ resolution: 20 });
  try {
    h.enable();
  } catch (e) {
    console.warn(`[metrics][${serviceName}] monitorEventLoopDelay enable failed: ${e.message}`);
  }

  const interval = setInterval(() => {
    try {
      const p99ns = h.percentile(99);
      eventLoopLagP99Ms.set(p99ns / 1e6); // ns -> ms

      const mu = process.memoryUsage();
      heapUsedBytes.set(mu.heapUsed);
      rssBytes.set(mu.rss);
    } catch {
      // metrics는 보조 기능: 실패해도 본 서비스 영향 X
    }
  }, 1000);
  interval.unref();

  // --- optional: GC duration histogram (환경/Node 버전에 따라 엔트리 미지원 가능) ---
  const gcDurationSeconds = new client.Histogram({
    name: "nodejs_gc_duration_seconds_custom",
    help: "GC duration seconds by kind (perf_hooks PerformanceObserver)",
    labelNames: ["kind"],
    buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
    registers: [register],
  });

  const GC_KIND = {
    [constants.NODE_PERFORMANCE_GC_MAJOR]: "major",
    [constants.NODE_PERFORMANCE_GC_MINOR]: "minor",
    [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: "incremental",
    [constants.NODE_PERFORMANCE_GC_WEAKCB]: "weakcb",
  };

  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const kind = GC_KIND[entry.kind] || "unknown";
        gcDurationSeconds.labels(kind).observe(entry.duration / 1000); // ms -> s
      }
    });
    obs.observe({ entryTypes: ["gc"] });
  } catch {
    // GC 엔트리 미지원이면 event loop/heap/rss만으로도 충분히 원인 분해 가능
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" || req.url !== "/metrics") {
      res.statusCode = 404;
      return res.end("not found");
    }
    try {
      res.statusCode = 200;
      res.setHeader("Content-Type", register.contentType);
      res.end(await register.metrics());
    } catch {
      res.statusCode = 500;
      res.end("metrics error");
    }
  });

  // metrics는 보조 기능: 에러가 나도 본 서비스 영향 X
  server.on("error", (e) => {
    console.warn(`[metrics][${serviceName}] server error: ${e.message}`);
  });

  server.on("close", () => {
    try {
      clearInterval(interval);
    } catch {}
    try {
      if (typeof h.disable === "function") h.disable();
    } catch {}
  });

  server.listen(port, host, () => {
    console.log(`[metrics][${serviceName}] listening on http://${host}:${port}/metrics`);
  });

  return server;
}

module.exports = { startMetricsServer };

