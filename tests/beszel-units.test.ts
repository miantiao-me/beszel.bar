import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import { createBeszelClient } from "../src/beszel/client.ts";
import { createDetailLoader } from "../src/beszel/detail-loader.ts";
import { formatGb, formatMemoryMb, formatRate, formatShortRate } from "../src/beszel/format.ts";
import { buildAttention } from "../src/beszel/metrics.ts";
import type { Detail } from "../src/beszel/types.ts";
import { detectAlertTransitions } from "../src/domain/alerts.ts";
import { parseInboxContent } from "../src/inbox/parser.ts";
import { createBeszelStore } from "../src/store.ts";
import { host, requestURL, type FetchInput } from "./helpers.ts";

test("BeszelClient deduplicates concurrent logins with single-flight auth and re-auths on 401", async () => {
  let authCalls = 0;
  let expiredOnce = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: FetchInput, init?: RequestInit) => {
    const path = requestURL(url);
    if (path.includes("auth-with-password")) {
      authCalls++;
      return Response.json({ token: `tok-${authCalls}` });
    }
    const authHeader = new Headers(init?.headers).get("Authorization");
    if (path.includes("/need-reauth") && !expiredOnce && authHeader === "Bearer tok-1") {
      expiredOnce = true;
      return new Response(null, { status: 401 });
    }
    return Response.json({ ok: true, authHeader });
  });

  const client = createBeszelClient(() => ({
    baseUrl: "https://beszel.example",
    email: "ops@example.com",
    password: "secret",
  }));

  // 3 concurrent calls on a cold session must share a single login request.
  const results = await Promise.all([
    client.get<{ ok: boolean }>("/api/collections/systems/records", { perPage: 10 }),
    client.get<{ ok: boolean }>("/api/collections/alerts/records", { perPage: 10 }),
    client.get<{ ok: boolean }>("/api/collections/containers/records", { filter: 'system="s1"' }),
  ]);
  assert.equal(authCalls, 1);
  assert.ok(results.every((r) => r.ok));

  // A 401 response invalidates the token and retries once with a fresh token.
  const retried = await client.get<{ authHeader: string }>("/api/need-reauth");
  assert.equal(authCalls, 2);
  assert.equal(retried.authHeader, "Bearer tok-2");

  // Explicit reset clears cached token immediately.
  client.reset();
  await client.get("/api/collections/systems/records");
  assert.equal(authCalls, 3);
});

test("parseInboxContent handles JSON Shoutrrr payloads, malformed JSON, and plain text fallback", () => {
  const json = parseInboxContent(
    JSON.stringify({ title: "web-01 CPU 95%", message: "High load for 5m" }),
    "Beszel #1",
    true,
  );
  assert.deepEqual(json, { title: "web-01 CPU 95%", body: "High load for 5m" });

  const invalidJson = parseInboxContent("{not-json}\nsecond line", "Beszel #2", true);
  assert.deepEqual(invalidJson, { title: "{not-json}", body: "second line" });

  const keepSubject = parseInboxContent("Disk reached 92% on /var", "db-01 Disk Alert", false);
  assert.deepEqual(keepSubject, {
    title: "db-01 Disk Alert",
    body: "Disk reached 92% on /var",
  });
});

test("detectAlertTransitions emits once on state entry and re-arms after recovery", () => {
  const hotSys = [
    { id: "s1", name: "app", status: "up" as const, info: { cpu: 94, mp: 30, dp: 20 } },
  ];
  const coolSys = [
    { id: "s1", name: "app", status: "up" as const, info: { cpu: 20, mp: 30, dp: 20 } },
  ];

  const t1 = detectAlertTransitions(hotSys, new Set(), new Set(), 90, "zh");
  assert.equal(t1.transitions.length, 1);
  assert.equal(t1.transitions[0]!.title, "app CPU 94%");

  const t2 = detectAlertTransitions(hotSys, t1.nextDown, t1.nextHot, 90, "zh");
  assert.equal(t2.transitions.length, 0, "持续超阈不应重复触发");

  const t3 = detectAlertTransitions(coolSys, t2.nextDown, t2.nextHot, 90, "zh");
  const t4 = detectAlertTransitions(hotSys, t3.nextDown, t3.nextHot, 90, "zh");
  assert.equal(t4.transitions.length, 1, "恢复正常后再次超阈应重新触发");
});

test("buildAttention deduplicates offline Status rules and triggered resource rules", () => {
  const items = buildAttention(
    [
      { id: "s1", name: "edge", status: "down" },
      { id: "s2", name: "api", status: "up", info: { cpu: 96, mp: 40, dp: 20 } },
    ],
    [
      { id: "a1", system: "s1", name: "Status", triggered: true },
      { id: "a2", system: "s2", name: "CPU Usage", triggered: true, value: 90 },
    ],
    90,
    "en",
  );
  assert.deepEqual(
    items.map((i) => `${i.kind}:${i.systemId}`),
    ["offline:s1", "alert:s2"],
  );
});

test("pretty-bytes formatting helpers preserve compact and standard binary units", () => {
  assert.equal(formatMemoryMb(1536), "1.5 GB");
  assert.equal(formatMemoryMb(128), "128 MB");
  assert.equal(formatGb(4.5), "4.5 GB");
  assert.equal(formatGb(1536), "1.5 TB");
  assert.equal(formatRate(2_621_440, false), "2.5 MB/s");
  assert.equal(formatRate(2_621_440, true), "2.5M/s");
  assert.equal(formatRate(500, true), "500B/s");
  assert.equal(formatShortRate(2_621_440), "2.5M");
  assert.equal(formatRate(null), "—");
});

test("detail loader sends skipTotal=1 and batches Wave 1 metadata with stats into a single publish", async () => {
  const seenUrls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: FetchInput) => {
    const path = requestURL(url);
    seenUrls.push(path);
    if (path.includes("auth-with-password")) return Response.json({ token: "tok" });
    if (path.includes("system_details")) return Response.json({ id: "s1", cores: 8 });
    if (path.includes("containers")) {
      return Response.json({ items: [{ id: "c1", name: "web", status: "running" }] });
    }
    if (path.includes("system_stats")) {
      await new Promise((r) => setTimeout(r, 15));
      return Response.json({ items: [{ created: new Date().toISOString(), stats: { cpu: 42 } }] });
    }
    return Response.json({ items: [] });
  });

  const client = createBeszelClient(() => ({
    baseUrl: "https://beszel.example",
    email: "ops@example.com",
    password: "secret",
  }));
  let current: Detail | null = null;
  let publishes = 0;
  const loader = createDetailLoader(client, {
    getConnectionKey: () => "conn",
    getActiveTarget: () => ({ id: "s1", period: "1h" }),
    hasSystem: () => true,
    getLang: () => "zh",
    getCurrentDetail: () => current,
    setDetail: (d) => {
      current = d;
      if (d) publishes++;
    },
    setLoading: () => {},
    onError: () => {},
  });

  await loader.open("s1", "1h");
  assert.equal(publishes, 1, "Wave 1 应合并元数据与曲线一次发布，且空服务/硬盘不重复触发渲染");
  assert.equal(current!.points.length, 1);
  assert.equal(current!.containers.length, 1);
  assert.equal(current!.details?.cores, 8);
  const listUrls = seenUrls.filter((u) => u.includes("/records?"));
  assert.ok(listUrls.length >= 4);
  assert.ok(
    listUrls.every((u) => new URL(u).searchParams.get("skipTotal") === "1"),
    "所有 PocketBase 列表查询均应携带 skipTotal=1",
  );
});

test("store watchInvalidation fires synchronously without depending on Vue async flushJobs", () => {
  host();
  const store = createBeszelStore(() => {});
  let ticks = 0;
  store.watchInvalidation(() => {
    ticks++;
  });
  store.detailIdRef.value = "s1";
  assert.equal(ticks, 1, "状态变更必须同步通知宿主 invalidate，避免被异步微任务中断卡死");
  store.searchQueryRef.value = "web";
  assert.equal(ticks, 2);
});
