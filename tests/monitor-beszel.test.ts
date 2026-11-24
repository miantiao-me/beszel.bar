import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import dashboard from "../src/index.ts";
import { capture, click, find, host, nodes, settled, text } from "./helpers.ts";

host();

test("preserves missing CPU measurements, single-point dots, and full container list with memory", async () => {
  Object.assign($metrix, { secret: () => "fixture" });
  globalThis.fetch = async (url) => {
    const path = url instanceof Request ? url.url : url.toString();
    if (path.includes("auth-with-password")) return Response.json({ token: "fixture" });
    if (path.includes("system_stats")) {
      return Response.json({
        items: [
          { created: new Date(Date.now() - 60_000).toISOString(), stats: { mp: 25 } },
          {
            created: new Date().toISOString(),
            stats: { cpu: 30, mp: 28, m: 16, mu: 4.5, d: 200, du: 30 },
          },
        ],
      });
    }
    if (path.includes("containers")) {
      return Response.json({
        items: Array.from({ length: 6 }, (_, i) => ({
          id: String(i),
          name: `容器-${i}`,
          cpu: i === 2 ? 12 : 5,
          memory: i === 2 ? 1536 : 128,
          health: i === 5 ? 3 : 2,
          status: i === 5 ? "Up 2h (unhealthy)" : "running",
        })),
      });
    }
    if (path.includes("system_details")) {
      return Response.json({
        id: "s1",
        hostname: "host-01.lan",
        kernel: "6.8.0-generic",
        cores: 8,
        threads: 16,
        cpu: "AMD EPYC",
        os_name: "Ubuntu 24.04",
      });
    }
    if (path.includes("systemd_services")) {
      return Response.json({
        items: [{ id: "sv1", name: "nginx.service", state: "failed", sub: "failed" }],
      });
    }
    if (path.includes("smart_devices")) {
      return Response.json({
        items: [
          { id: "d1", name: "/dev/nvme0", model: "Samsung 990 Pro", state: "PASSED", temp: 41 },
        ],
      });
    }
    if (path.includes("alerts")) {
      return Response.json({ items: [] });
    }
    return Response.json({
      items: [
        {
          id: "s1",
          name: "主机",
          status: "up",
          host: "fixture",
          info: { cpu: 30, mp: 28, dp: 15, bb: 2_621_440 },
        },
      ],
    });
  };

  const env = { inputs: { lang: "zh", server: "https://fixture.invalid/" } };
  await dashboard.scheduled(env);
  const view = dashboard.render(env);
  await capture("beszel", view.panel);
  click(
    nodes(view.panel).find((node) => node.props?.key === "system-s1" || node.key === "system-s1")!,
  );
  await settled();
  await settled();
  await settled();
  const detail = dashboard.render(env).panel;
  await capture("beszel-detail", detail);
  const detailText = text(detail);
  assert.match(detailText, /容器-5/);
  assert.match(detailText, /1\.5 GB/);
  assert.match(detailText, /Ubuntu 24\.04/);
  assert.match(detailText, /8C \/ 16T/);
  assert.match(detailText, /nginx\.service/);
  assert.match(detailText, /Samsung 990 Pro/);

  const chart = nodes(detail).find((node) => node.type === "Chart")!;
  const domain = chart.props!.xDomain as [number, number];
  assert.ok(domain, "一小时标签必须与实际时间轴一致");
  assert.equal(domain[1] - domain[0], 3_600_000);
  assert.equal(chart.props!.dots, true, "单个有效样本也必须可见");
  const cpu = (chart.props!.series as { name: string; points: { y: number }[] }[]).filter((s) =>
    s.name.startsWith("CPU"),
  );
  assert.ok(cpu.every((series) => series.points.every((point) => point.y !== 0)));
});

test("switches between CPU, memory, modern stats.b network, disk I/O and periods", async () => {
  const seenFilters: string[] = [];
  globalThis.fetch = async (url) => {
    const path = url instanceof Request ? url.url : url.toString();
    if (path.includes("auth-with-password")) return Response.json({ token: "fixture" });
    if (path.includes("system_stats")) {
      seenFilters.push(new URL(path).searchParams.get("filter") || "");
      return Response.json({
        items: [
          {
            created: new Date(Date.now() - 120_000).toISOString(),
            stats: { cpu: 25, mp: 40, b: [524_288, 1_572_864], dio: [2_097_152, 1_048_576] },
          },
          {
            created: new Date(Date.now() - 60_000).toISOString(),
            stats: { cpu: 35, mp: 44, b: [786_432, 2_097_152], dio: [3_145_728, 1_572_864] },
          },
        ],
      });
    }
    if (
      path.includes("containers") ||
      path.includes("alerts") ||
      path.includes("systemd") ||
      path.includes("smart")
    ) {
      return Response.json({ items: [] });
    }
    if (path.includes("system_details")) return new Response(null, { status: 404 });
    return Response.json({
      items: [{ id: "s1", name: "主机", status: "up", info: { cpu: 35, mp: 44, dp: 20 } }],
    });
  };

  const env = { inputs: { lang: "zh", server: "https://fixture.invalid/" } };
  await dashboard.scheduled(env);
  await settled();
  await settled();
  let detail = dashboard.render(env).panel;
  let picker = nodes(detail).find((node) => node.props?.key === "metric-picker")!;
  assert.ok(picker);

  // Multiple continuous points should not render noisy dots.
  const cpuChart = nodes(detail).find((node) => node.type === "Chart")!;
  assert.equal(cpuChart.props!.dots, false);

  (picker.props!.onChange as (value: string) => void)("MEM");
  detail = dashboard.render(env).panel;
  const memChart = nodes(detail).find((node) => node.type === "Chart")!;
  const memSeries = memChart.props!.series as { name: string; points: { y: number }[] }[];
  assert.ok(memSeries.every((item) => item.name.startsWith("内存")));
  assert.deepEqual(
    memSeries.flatMap((item) => item.points.map((point) => point.y)),
    [40, 44],
  );

  (picker.props!.onChange as (value: string) => void)("NET");
  detail = dashboard.render(env).panel;
  const netChart = nodes(detail).find((node) => node.type === "Chart")!;
  const netSeries = netChart.props!.series as { name: string; points: { y: number }[] }[];
  assert.equal(netSeries.length, 2, "网络图应包含下行与上行两条曲线");
  assert.match(netSeries[0]!.name, /MB\/s/);
  assert.deepEqual(
    netSeries[0]!.points.map((p) => p.y),
    [1.5, 2],
  );

  (picker.props!.onChange as (value: string) => void)("DISK");
  detail = dashboard.render(env).panel;
  assert.ok(
    nodes(detail).find((node) => node.type === "Chart"),
    "存在磁盘 I/O 时可切换磁盘曲线",
  );

  const periodPicker = nodes(detail).find((node) => node.props?.key === "period-picker")!;
  (periodPicker.props!.onChange as (value: string) => void)("24h");
  await settled();
  await settled();
  assert.ok(
    seenFilters.some((f) => f.includes('type="20m"')),
    "24h 应查询 20m 聚合样本",
  );

  (picker.props!.onChange as (value: string) => void)("CPU");
});

test("shows an unavailable reading when the selected metric has no samples", async () => {
  const env = { inputs: { lang: "zh", server: "https://fixture.invalid/" } };
  click(find(dashboard.render(env).panel, "返回"));
  globalThis.fetch = async (url) => {
    const path = url instanceof Request ? url.url : url.toString();
    if (path.includes("auth-with-password")) return Response.json({ token: "fixture" });
    if (path.includes("system_stats")) {
      return Response.json({ items: [{ created: new Date().toISOString(), stats: { mp: 41 } }] });
    }
    if (path.includes("system_details")) return new Response(null, { status: 404 });
    if (
      path.includes("containers") ||
      path.includes("alerts") ||
      path.includes("systemd") ||
      path.includes("smart")
    ) {
      return Response.json({ items: [] });
    }
    return Response.json({
      items: [
        {
          id: "missing-cpu",
          name: "内存节点",
          status: "up",
          info: { cpu: 0, mp: 41, dp: 12 },
        },
      ],
    });
  };
  await dashboard.scheduled(env);
  const list = dashboard.render(env).panel;
  click(nodes(list).find((node) => node.props?.key === "system-missing-cpu")!);
  await settled();
  await settled();
  await settled();
  let detail = dashboard.render(env).panel;
  let picker = nodes(detail).find((node) => node.props?.key === "metric-picker")!;
  (picker.props!.onChange as (value: string) => void)("CPU");
  detail = dashboard.render(env).panel;
  assert.equal(nodes(detail).filter((node) => node.type === "Chart").length, 0);
  assert.match(text(detail), /暂无数据/);
  picker = nodes(detail).find((node) => node.props?.key === "metric-picker")!;
  (picker.props!.onChange as (value: string) => void)("MEM");
  const chart = nodes(dashboard.render(env).panel).find((node) => node.type === "Chart");
  assert.ok(chart);
  await capture("beszel-missing-cpu", detail);
});

test("alerts, wide split view, notch, single-server widget, and credential reset work cleanly", async () => {
  const env = { inputs: { lang: "zh", server: "https://fixture.invalid/" } };
  click(find(dashboard.render(env).panel, "返回"));
  let authCalls = 0;
  globalThis.fetch = async (url) => {
    const path = url instanceof Request ? url.url : url.toString();
    if (path.includes("auth-with-password")) {
      authCalls++;
      return Response.json({ token: `tok-${authCalls}` });
    }
    if (path.includes("alerts")) {
      return Response.json({
        items: [{ id: "al1", system: "a", name: "Memory High", triggered: true, value: 90 }],
      });
    }
    if (path.includes("system_stats")) {
      return Response.json({
        items: [{ created: new Date().toISOString(), stats: { cpu: 20, mp: 95 } }],
      });
    }
    if (path.includes("system_details")) return new Response(null, { status: 404 });
    if (path.includes("containers") || path.includes("systemd") || path.includes("smart")) {
      return Response.json({ items: [] });
    }
    return Response.json({
      items: [
        { id: "a", name: "web", status: "up", info: { cpu: 20, mp: 95, dp: 10, b: 12.5 } },
        { id: "b", name: "db", status: "up", info: { cpu: 5, mp: 20, dp: 10, b: 1.2 } },
      ],
    });
  };
  const sent: string[] = [];
  let openedPanel = 0;
  Object.assign(globalThis, {
    Notification: class {
      onclick: (() => void) | null = null;
      constructor(title: string) {
        sent.push(title);
      }
    },
  });
  Object.assign($metrix, {
    outputs: () => ({
      tray: true,
      panel: true,
      notch: "expanded",
      widget: { known: true, families: ["small", "medium", "large"] },
    }),
    caniuse: async () => true,
    panel: {
      open: async () => {
        openedPanel++;
        return {
          open: true,
          mode: "flyout",
          source: "programmatic",
          alwaysOnTop: false,
          alwaysOnTopSupported: false,
          alwaysOnTopEffective: null,
        };
      },
    },
  });

  await dashboard.scheduled({ inputs: { ...env.inputs, notify: true, threshold: 90 } });
  await dashboard.scheduled({ inputs: { ...env.inputs, notify: true, threshold: 90 } });
  assert.deepEqual(sent, ["web 内存 95%"], "越过阈值只通知一次");

  // Wide window renders list and detail side-by-side.
  const wideView = dashboard.render({
    inputs: { ...env.inputs, widgetMode: "system", widgetSystem: "web" },
    viewport: { width: 960, height: 640, titleBar: { height: 28, left: 0, right: 0 } },
  });
  const wideText = text(wideView.panel);
  assert.match(wideText, /\bweb\b/);
  assert.match(wideText, /95%/);
  assert.match(wideText, /历史趋势/);
  assert.match(text(wideView.widget?.small), /web/);
  assert.ok(wideView.notch, "应生成刘海屏视图");

  // Notification click navigates directly to the server detail and opens panel.
  dashboard.event("system", { type: "notification.click", tag: "beszel-sys-b" });
  assert.equal(openedPanel, 1);

  // Changing server origin resets cached token & systems immediately.
  const switchedEnv = { inputs: { lang: "zh", server: "https://other-beszel.invalid" } };
  const beforeSync = dashboard.render(switchedEnv);
  assert.doesNotMatch(text(beforeSync.panel), /\bweb\b/);
  await dashboard.scheduled(switchedEnv);
  assert.ok(authCalls >= 1, "切换服务器后应重新登录获取新 token");
});

test("supports reactive updates, search, cards/table toggle, simplified tray, and Plus Inbox alerts", async () => {
  const removed: number[] = [];
  let invalidations = 0;
  Object.assign($metrix, {
    invalidate: () => {
      invalidations++;
    },
    secret: () => "fixture",
    subscription: () => "plus",
    caniuse: async () => true,
    inbox: {
      boxes: async () => [
        {
          id: "box-1",
          name: "Ops Alerts",
          address: "ops@agili-inbox.com",
          paused: false,
          message_count: 1,
          last_received_at: Math.floor(Date.now() / 1000),
        },
      ],
      list: async () => [
        {
          seq: 7,
          inbox_id: "box-1",
          source: "webhook",
          received_at: Math.floor(Date.now() / 1000) - 30,
          size: 120,
          subject: "web-01 CPU critical",
          sender: "beszel",
        },
      ],
      read: async () => new Uint8Array(),
      message: async () => ({
        subject: "web-01 CPU critical",
        from: [{ address: "beszel@local" }],
        to: [],
        cc: [],
        text: "Host web-01 exceeded 95% CPU for 5 minutes.",
        attachments: [],
      }),
      remove: async (_id: string, seq: number) => {
        removed.push(seq);
      },
    },
  });

  globalThis.fetch = async (url) => {
    const path = url instanceof Request ? url.url : url.toString();
    if (path.includes("auth-with-password")) return Response.json({ token: "tok-inbox" });
    if (path.includes("alerts")) return Response.json({ items: [] });
    return Response.json({
      items: Array.from({ length: 7 }, (_, idx) => ({
        id: `n${idx}`,
        name: idx === 0 ? "web-01" : `node-0${idx}`,
        status: "up",
        info: { cpu: 10 + idx * 10, mp: 30, dp: 20, bb: (idx + 1) * 1_048_576 },
      })),
    });
  };

  const env = { inputs: { lang: "zh", server: "https://inbox-test.invalid" } };
  await dashboard.scheduled(env);
  await settled();
  await settled();

  // Search box appears when > 6 servers and filters reactively
  let panel = dashboard.render(env).panel;
  assert.equal(panel?.props?.preferredWidth, 460);
  assert.equal(panel?.props?.preferredHeight, 540, "窄窗应保持固定高度避免抖动");
  assert.doesNotMatch(text(panel), /台全部在线/, "顶栏不应显示与 KPI 卡片重复的在线状态副标题");

  // Cards mode uses native MenuButton instead of Segmented tabs for sorting
  assert.equal(
    nodes(panel).find((n) => n.props?.key === "sort-picker"),
    undefined,
    "不应使用 Segmented Tab 做排序",
  );
  const sortMenu = nodes(panel).find((n) => n.props?.key === "sort-menu")!;
  assert.equal(sortMenu.type, "MenuButton");
  const sortMenuItems = (sortMenu.props?.menu ?? []) as { label: string; onClick: () => void }[];
  const cpuItem = sortMenuItems.find((item) => item.label === "CPU")!;
  cpuItem.onClick();
  await settled();
  panel = dashboard.render(env).panel;
  assert.equal(nodes(panel).find((n) => n.props?.key === "sort-menu")?.props?.label, "CPU ↓");

  const beforeSearchInvalidations = invalidations;
  const searchField = nodes(panel).find((n) => n.props?.key === "system-search")!;
  (searchField.props!.onChange as (v: string) => void)("web-01");
  await settled();
  assert.ok(
    invalidations > beforeSearchInvalidations,
    "Vue 3.5 响应式状态变化应自动触发 invalidate",
  );
  panel = dashboard.render(env).panel;
  assert.equal(panel?.props?.preferredHeight, 540, "筛选为单行卡片时高度依然固定");
  assert.match(text(panel), /web-01/);
  assert.doesNotMatch(text(panel), /node-06/);
  (
    nodes(panel).find((n) => n.props?.key === "system-search")!.props!.onChange as (
      v: string,
    ) => void
  )("");
  panel = dashboard.render(env).panel;

  // Toggle layout to table
  click(nodes(panel).find((n) => n.props?.key === "toggle-layout")!);
  panel = dashboard.render(env).panel;
  assert.equal(panel?.props?.preferredHeight, 540, "切换表格视图后高度依然固定");
  assert.match(text(panel), /主机/);

  // Simplified tray: compact online title, Tabler server monochrome mark, concise menu
  const rendered = dashboard.render(env);
  const trayMenu = (rendered.tray?.menu as { label?: string }[] | undefined) ?? [];
  assert.equal(rendered.tray?.title, "7/7");
  assert.equal(rendered.tray?.iconTemplate, true);
  assert.match(String(rendered.tray?.icon), /M3%207a3%203/);
  assert.deepEqual(
    trayMenu.map((item) => item.label),
    ["打开 Beszel"],
  );

  // Open Alerts view via header bell icon and inspect simplified Plus Inbox alert
  click(nodes(panel).find((n) => n.props?.key === "header-alerts")!);
  await settled();
  await settled();
  panel = dashboard.render(env).panel;
  assert.equal(panel?.props?.preferredHeight, 540, "告警页高度依然固定");
  assert.match(text(panel), /web-01 CPU critical/);
  assert.doesNotMatch(text(panel), /Beszel 告警规则/, "不应重复展示单独的告警规则分区");
  const inboxCardBtn = nodes(panel).find((n) => n.props?.label === "web-01 CPU critical")!;
  click(inboxCardBtn);
  await settled();
  await settled();
  panel = dashboard.render(env).panel;
  assert.match(text(panel), /exceeded 95% CPU/);
  assert.doesNotMatch(text(panel), /标为未读/, "展开正文不应堆叠多余操作按钮");
  click(nodes(panel).find((n) => n.props?.key === "inbox-del-box-1:7")!);
  await settled();
  await settled();
  assert.deepEqual(removed, [7]);
  panel = dashboard.render(env).panel;
  assert.doesNotMatch(text(panel), /web-01 CPU critical/);

  // Back button returns cleanly to servers list
  click(nodes(panel).find((n) => n.props?.key === "alerts-back")!);
  panel = dashboard.render(env).panel;
  assert.match(text(panel), /主机/);
});

test("re-probes inbox.remove on inboxchange and retries transient inbox busy errors on delete", async () => {
  let bound = false;
  let removeAttempts = 0;
  const messages = [
    {
      seq: 11,
      inbox_id: "box-late",
      source: "webhook",
      received_at: Math.floor(Date.now() / 1000) - 10,
      size: 64,
      subject: "db-01 disk 96%",
      sender: "beszel",
    },
  ];
  const toasts: string[] = [];

  Object.assign($metrix, {
    secret: () => "fixture",
    subscription: () => "plus",
    toast: (msg: string) => {
      toasts.push(msg);
    },
    caniuse: async (name: string) => (name.startsWith("inbox.") ? bound : true),
    inbox: {
      boxes: async () =>
        bound
          ? [
              {
                id: "box-late",
                name: "Late Box",
                address: "late@agili-inbox.com",
                paused: false,
                message_count: messages.length,
                last_received_at: Math.floor(Date.now() / 1000),
              },
            ]
          : [],
      list: async () => [...messages],
      read: async () => new Uint8Array(),
      message: async () => ({
        subject: "db-01 disk 96%",
        from: [],
        to: [],
        cc: [],
        text: "disk full",
        attachments: [],
      }),
      remove: async (_id: string, seq: number) => {
        removeAttempts++;
        if (removeAttempts === 1) throw new Error("inbox busy");
        const idx = messages.findIndex((m) => m.seq === seq);
        if (idx >= 0) messages.splice(idx, 1);
      },
    },
  });

  globalThis.fetch = async (url) => {
    const path = url instanceof Request ? url.url : url.toString();
    if (path.includes("auth-with-password")) return Response.json({ token: "tok-late" });
    if (path.includes("alerts")) return Response.json({ items: [] });
    return Response.json({
      items: [{ id: "d1", name: "db-01", status: "up", info: { cpu: 12, mp: 30, dp: 96 } }],
    });
  };

  const env = { inputs: { lang: "zh", server: "https://late-inbox.invalid" } };
  await dashboard.scheduled(env);

  // Inbox is bound AFTER initial scheduled(); inboxchange must re-probe capabilities and enable delete.
  bound = true;
  dashboard.event("inboxchange", { inboxIds: ["box-late"] });
  await settled();
  await settled();
  await settled();

  click(nodes(dashboard.render(env).panel).find((n) => n.props?.key === "header-alerts")!);
  await settled();
  await settled();
  let panel = dashboard.render(env).panel;
  const quickDel = nodes(panel).find((n) => n.props?.key === "inbox-del-box-late:11");
  assert.ok(quickDel, "延迟绑定收件箱后应立即展示快捷删除按钮");
  click(quickDel);
  // Wait for 350ms backoff retry after transient "inbox busy" error.
  await new Promise((resolve) => setTimeout(resolve, 450));
  await settled();
  assert.equal(removeAttempts, 2, "遇到 inbox busy 应自动重试一次并成功删除");
  assert.equal(toasts.length, 0);
  panel = dashboard.render(env).panel;
  assert.doesNotMatch(text(panel), /db-01 disk 96%/);
});

test("caches server detail across reopen, parses JSON webhooks, prewarms inbox bodies, and hides refresh when unconfigured", async () => {
  // Unconfigured panel hides ineffective refresh/open controls.
  Object.assign($metrix, { secret: () => "" });
  const unconfigured = dashboard.render({
    inputs: { lang: "zh", server: "http://127.0.0.1:8090" },
  }).panel;
  assert.equal(
    nodes(unconfigured).find((n) => n.props?.key === "header-refresh"),
    undefined,
  );
  assert.equal(
    nodes(unconfigured).find((n) => n.props?.key === "header-open"),
    undefined,
  );

  let statsCalls = 0;
  let messageCalls = 0;
  Object.assign($metrix, {
    secret: () => "fixture",
    subscription: () => "plus",
    caniuse: async () => true,
    inbox: {
      boxes: async () => [
        {
          id: "beszel",
          name: "Beszel",
          address: "beszel@agili-inbox.com",
          paused: false,
          message_count: 1,
          last_received_at: Math.floor(Date.now() / 1000),
        },
      ],
      list: async () => [
        {
          seq: 1,
          inbox_id: "beszel",
          source: "webhook",
          received_at: Math.floor(Date.now() / 1000) - 5,
          size: 96,
          subject: "",
          sender: "",
        },
      ],
      read: async () => new Uint8Array(),
      message: async () => {
        messageCalls++;
        return {
          subject: "",
          from: [],
          to: [],
          cc: [],
          text: JSON.stringify({
            title: "prod-01 CPU 95%",
            message: "CPU stayed above 90% for 5 minutes.",
          }),
          attachments: [],
        };
      },
      remove: async () => {},
    },
  });

  globalThis.fetch = async (url) => {
    const path = url instanceof Request ? url.url : url.toString();
    if (path.includes("auth-with-password")) return Response.json({ token: "tok-cache" });
    if (path.includes("system_stats")) {
      statsCalls++;
      return Response.json({
        items: [{ created: new Date().toISOString(), stats: { cpu: 42, mp: 50 } }],
      });
    }
    if (path.includes("system_details")) return new Response(null, { status: 404 });
    if (
      path.includes("containers") ||
      path.includes("alerts") ||
      path.includes("systemd") ||
      path.includes("smart")
    ) {
      return Response.json({ items: [] });
    }
    return Response.json({
      items: [{ id: "c1", name: "prod-01", status: "up", info: { cpu: 42, mp: 50, dp: 20 } }],
    });
  };

  const env = { inputs: { lang: "zh", server: "https://cache-test.invalid" } };
  await dashboard.scheduled(env);
  // Let background inbox refresh + body prewarm finish.
  await settled();
  await settled();
  await settled();
  await settled();

  // First open fetches stats; closing and reopening immediately serves the 30s memory cache.
  click(nodes(dashboard.render(env).panel).find((n) => n.props?.key === "system-c1")!);
  await settled();
  await settled();
  assert.equal(statsCalls, 1);
  click(find(dashboard.render(env).panel, "返回"));
  click(nodes(dashboard.render(env).panel).find((n) => n.props?.key === "system-c1")!);
  await settled();
  assert.equal(statsCalls, 1, "30 秒内再次打开同一主机应直接命中内存缓存");
  assert.ok(nodes(dashboard.render(env).panel).find((n) => n.type === "Chart"));

  // Prewarmed JSON webhook alert shows extracted title & clean message without raw JSON braces.
  click(find(dashboard.render(env).panel, "返回"));
  click(nodes(dashboard.render(env).panel).find((n) => n.props?.key === "header-alerts")!);
  await settled();
  let alertsPanel = dashboard.render(env).panel;
  assert.equal(messageCalls, 1, "收件箱刷新后应后台预热最新消息正文");
  assert.match(text(alertsPanel), /prod-01 CPU 95%/);
  click(nodes(alertsPanel).find((n) => n.props?.key === "inbox-open-beszel:1")!);
  alertsPanel = dashboard.render(env).panel;
  assert.match(text(alertsPanel), /CPU stayed above 90%/);
  assert.doesNotMatch(text(alertsPanel), /\{"title"/);
});
