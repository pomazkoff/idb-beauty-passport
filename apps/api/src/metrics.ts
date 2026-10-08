/** Минимальные метрики в формате Prometheus без внешних зависимостей (ТЗ 12). */
import { type Db, ensiOutbox } from "@idb/db";
import { count } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

type Hist = { buckets: number[]; counts: number[]; sum: number; total: number };
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export class Metrics {
  private readonly requests = new Map<string, number>();
  private readonly latency = new Map<string, Hist>();
  readonly counters = new Map<string, number>();

  inc(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  observe(route: string, status: number, seconds: number) {
    const k = `${route}|${status}`;
    this.requests.set(k, (this.requests.get(k) ?? 0) + 1);
    let h = this.latency.get(route);
    if (!h) {
      h = { buckets: BUCKETS, counts: BUCKETS.map(() => 0), sum: 0, total: 0 };
      this.latency.set(route, h);
    }
    h.sum += seconds;
    h.total++;
    BUCKETS.forEach((b, i) => {
      if (seconds <= b) h!.counts[i]!++;
    });
  }

  async render(db: Db): Promise<string> {
    const out: string[] = [];
    out.push("# TYPE http_requests_total counter");
    for (const [k, v] of this.requests) {
      const [route, status] = k.split("|");
      out.push(`http_requests_total{route="${route}",status="${status}"} ${v}`);
    }
    out.push("# TYPE http_request_duration_seconds histogram");
    for (const [route, h] of this.latency) {
      let cum = 0;
      h.buckets.forEach((b, i) => {
        cum += h.counts[i]!;
        out.push(`http_request_duration_seconds_bucket{route="${route}",le="${b}"} ${cum}`);
      });
      out.push(`http_request_duration_seconds_bucket{route="${route}",le="+Inf"} ${h.total}`);
      out.push(`http_request_duration_seconds_sum{route="${route}"} ${h.sum}`);
      out.push(`http_request_duration_seconds_count{route="${route}"} ${h.total}`);
    }
    for (const [k, v] of this.counters) out.push(`${k} ${v}`);
    const rows = await db
      .select({ status: ensiOutbox.status, n: count() })
      .from(ensiOutbox)
      .groupBy(ensiOutbox.status);
    out.push("# TYPE ensi_outbox_size gauge");
    for (const r of rows) out.push(`ensi_outbox_size{status="${r.status}"} ${r.n}`);
    return `${out.join("\n")}\n`;
  }
}

/** fastify-plugin: хук onResponse должен видеть все маршруты, а не только свой контекст. */
export const metricsRoutes = fp(async (app: FastifyInstance, opts: { db: Db; metrics: Metrics }) => {
  app.addHook("onResponse", (req, reply, done) => {
    const route = req.routeOptions.url ?? "unknown";
    if (route !== "/metrics") opts.metrics.observe(route, reply.statusCode, reply.elapsedTime / 1000);
    done();
  });
  app.get(
    "/metrics",
    { schema: { tags: ["ops"], security: [], summary: "Prometheus-метрики" } },
    async (_req, reply) => reply.type("text/plain; version=0.0.4").send(await opts.metrics.render(opts.db)),
  );
});
