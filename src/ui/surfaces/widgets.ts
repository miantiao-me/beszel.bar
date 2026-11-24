import { clamp } from "es-toolkit";
import { formatRate, levelTone, statusTone, statusWord, uptime } from "../../beszel/format.ts";
import { systemBandwidthBytes } from "../../beszel/metrics.ts";
import type { SystemRecord } from "../../beszel/types.ts";
import { t, type Lang } from "../../host/bridge.ts";
import { h, type Tone, type VNode } from "../kit.ts";
import { PAL } from "../theme.ts";
import { MARK, type SurfaceContext } from "./types.ts";

type Family = "small" | "medium" | "large";
type WidgetColor = "primary" | "secondary" | "accent" | "success" | "warning" | "error";

const TONE_COLOR: Record<Tone, WidgetColor> = {
  success: "success",
  warning: "warning",
  danger: "error",
  accent: "accent",
  muted: "secondary",
};

const wColor = (tone: Tone): WidgetColor => TONE_COLOR[tone];
const pct = (v: number) => `${Math.round(v)}%`;
const wText = (text: string, props: Record<string, unknown> = {}) =>
  h("Text", { text, maxLines: 1, ...props });

function wRow(left: VNode, right: VNode, gap = 8): VNode {
  return h("Row", { gap, alignItems: "center" }, left, h("Spacer"), right);
}

function wHeader(title: string, trailing?: VNode | null): VNode {
  return h(
    "Row",
    { gap: 6, alignItems: "center" },
    h("Icon", { svg: MARK, size: 14, color: "primary" }),
    wText(title, { fontSize: 13, fontWeight: 600 }),
    h("Spacer"),
    trailing ?? null,
  );
}

function wNote(header: VNode, message: string, detail?: string): VNode {
  return h(
    "Column",
    { gap: 6 },
    header,
    h("Spacer"),
    wText(message, { fontSize: 13, fontWeight: 600, maxLines: 2 }),
    detail ? wText(detail, { fontSize: 11, color: "secondary", maxLines: 3 }) : null,
    h("Spacer"),
  );
}

function wBar(label: string, value: number): VNode {
  return h(
    "Column",
    { gap: 4 },
    wRow(wText(label, { fontSize: 12 }), wText(pct(value), { fontSize: 12, fontWeight: 600 }), 6),
    h("Progress", { value: clamp(value / 100, 0, 1), color: wColor(levelTone(value)) }),
  );
}

function metricBarsGrid(info: { cpu: number; mp: number; dp: number }, lang: Lang): VNode {
  return h(
    "Grid",
    { columns: 3, gap: 10 },
    wBar("CPU", info.cpu),
    wBar(t(lang, "内存", "MEM"), info.mp),
    wBar(t(lang, "磁盘", "DISK"), info.dp),
  );
}

function resolveWidgetSystem(ctx: SurfaceContext): SystemRecord | undefined {
  const { systems, widgetSystem, selectedSystemId } = ctx;
  const query = widgetSystem.trim();
  if (query) {
    const byId = systems.find((s) => s.id === query);
    if (byId) return byId;
    const matches = systems.filter((s) => s.name.toLowerCase() === query.toLowerCase());
    if (matches.length === 1) return matches[0];
  }
  return (selectedSystemId && systems.find((s) => s.id === selectedSystemId)) || systems[0];
}

function singleSystemWidget(ctx: SurfaceContext, family: Family): VNode {
  const { lang } = ctx;
  const system = resolveWidgetSystem(ctx);
  const header = wHeader(
    system?.name || "Beszel",
    system
      ? wText(statusWord(system.status, lang), {
          fontSize: 11,
          fontWeight: 600,
          color: wColor(statusTone(system.status)),
        })
      : null,
  );
  if (!system) return wNote(header, t(lang, "暂无主机", "No servers yet"));
  const info = system.info;
  if (system.status !== "up" || !info) {
    return wNote(header, statusWord(system.status, lang), system.host || info?.h || "");
  }
  if (family === "small") {
    return h(
      "Column",
      { gap: 6 },
      header,
      h("Spacer"),
      wBar("CPU", info.cpu),
      wBar(t(lang, "内存", "MEM"), info.mp),
      wBar(t(lang, "磁盘", "DISK"), info.dp),
    );
  }
  const bw = systemBandwidthBytes(info);
  const bars = metricBarsGrid(info, lang);
  if (family === "medium") {
    return h(
      "Column",
      { gap: 8 },
      header,
      h("Spacer"),
      bars,
      wRow(
        wText(uptime(info.u, lang), { fontSize: 11, color: "secondary" }),
        wText(bw !== null ? formatRate(bw, true) : system.host || "", {
          fontSize: 11,
          color: "secondary",
        }),
      ),
    );
  }

  const pts = ctx.detail?.id === system.id ? ctx.detail.points : [];
  const pickSeries = (pick: (s: (typeof pts)[number]["stats"]) => number | undefined) =>
    pts
      .map((p) => pick(p.stats))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .slice(-48);
  const cpuPts = pickSeries((s) => s.cpu);
  const memPts = pickSeries((s) => s.mp);

  return h(
    "Column",
    { gap: 10 },
    header,
    bars,
    ctx.caps.widgetChart && (cpuPts.length > 1 || memPts.length > 1)
      ? h("Chart", {
          type: "line",
          height: 86,
          yDomain: [0, 100],
          strokeWidth: 1.5,
          series: [
            ...(cpuPts.length > 1 ? [{ color: PAL.blue, points: cpuPts }] : []),
            ...(memPts.length > 1 ? [{ color: PAL.emerald, points: memPts }] : []),
          ],
        })
      : null,
    h("Divider"),
    wRow(
      wText(t(lang, "运行", "Uptime"), { fontSize: 11, color: "secondary" }),
      wText(uptime(info.u, lang), { fontSize: 11 }),
    ),
    bw !== null
      ? wRow(
          wText(t(lang, "网络", "Network"), { fontSize: 11, color: "secondary" }),
          wText(formatRate(bw), { fontSize: 11 }),
        )
      : null,
    h("Spacer"),
  );
}

function alertsWidget(ctx: SurfaceContext, family: Family): VNode {
  const { lang, systems, attentionItems: attn, inboxUnreadKeys, inboxAlerts } = ctx;
  const total = attn.length + inboxUnreadKeys.size;
  const header = wHeader(
    "Beszel",
    family === "small"
      ? null
      : wText(
          total ? t(lang, `${total} 项告警`, `${total} alerts`) : t(lang, "全部正常", "All clear"),
          { fontSize: 11, fontWeight: 600, color: total ? "warning" : "success" },
        ),
  );
  if (total === 0) {
    return wNote(
      header,
      t(lang, "全部正常", "All clear"),
      t(lang, `${systems.length} 台主机运行平稳`, `${systems.length} servers healthy`),
    );
  }
  if (family === "small") {
    return h(
      "Column",
      { gap: 4 },
      header,
      h("Spacer"),
      wText(String(total), { fontSize: 30, fontWeight: 700, color: "error" }),
      wText(attn[0]?.title || inboxAlerts[0]?.title || "", {
        fontSize: 11,
        color: "secondary",
        maxLines: 2,
      }),
    );
  }
  const combined = [
    ...attn.map((i) => ({ title: i.title, sub: i.detail, critical: i.severity === "critical" })),
    ...inboxAlerts
      .filter((a) => inboxUnreadKeys.has(a.key))
      .map((a) => ({
        title: a.title,
        sub: a.systemName || a.source,
        critical: a.severity === "critical",
      })),
  ].slice(0, family === "medium" ? 3 : 6);

  return h(
    "Column",
    { gap: 8 },
    header,
    ...combined.map((item) =>
      wRow(
        wText(item.title, {
          fontSize: 12,
          fontWeight: 600,
          color: item.critical ? "error" : "warning",
        }),
        wText(item.sub, { fontSize: 11, color: "secondary" }),
      ),
    ),
    h("Spacer"),
  );
}

function overviewWidget(ctx: SurfaceContext, family: Family): VNode {
  const { lang, systems, fleetSummary: summary } = ctx;
  const color = wColor(ctx.verdictTone);
  const header = wHeader(
    "Beszel",
    family === "small" || !systems.length
      ? null
      : wText(ctx.verdictText, { fontSize: 11, fontWeight: 600, color }),
  );
  if (!ctx.configured) {
    return wNote(
      header,
      t(lang, "未连接", "Not connected"),
      t(lang, "在设置中填写地址与账号", "Enter server URL and account in settings"),
    );
  }
  if (!systems.length) return wNote(header, ctx.verdictText);

  if (family === "small") {
    return h(
      "Column",
      { gap: 4 },
      header,
      h("Spacer"),
      h(
        "Row",
        { gap: 4, alignItems: "end" },
        wText(String(summary.up), {
          fontSize: 30,
          fontWeight: 700,
          color: summary.up === summary.total ? "primary" : color,
        }),
        wText(`/ ${summary.total} ${t(lang, "在线", "up")}`, { fontSize: 12, color: "secondary" }),
      ),
      wText(ctx.verdictText, { fontSize: 11, color, maxLines: 2 }),
    );
  }

  if (family === "medium") {
    return h(
      "Column",
      { gap: 7 },
      header,
      h("Spacer"),
      ...systems.slice(0, 4).map((system) => {
        const info = system.info;
        const live = system.status === "up" && info;
        return wRow(
          wText(system.name, {
            fontSize: 12,
            fontWeight: 500,
            color: live ? "primary" : wColor(statusTone(system.status)),
          }),
          live
            ? wText(
                `CPU ${pct(info.cpu)} · ${t(lang, "内存", "MEM")} ${pct(info.mp)} · ${t(lang, "磁盘", "DISK")} ${pct(info.dp)}`,
                {
                  fontSize: 11,
                  color:
                    Math.max(info.cpu, info.mp, info.dp) >= 65
                      ? wColor(levelTone(Math.max(info.cpu, info.mp, info.dp)))
                      : "secondary",
                },
              )
            : wText(statusWord(system.status, lang), {
                fontSize: 11,
                color: wColor(statusTone(system.status)),
              }),
        );
      }),
      h("Spacer"),
    );
  }

  const cpuSpark = ctx.fleetHistory.map((p) => p.avgCpu).slice(-32);
  return h(
    "Column",
    { gap: 8 },
    header,
    ctx.caps.widgetChart && cpuSpark.length > 1
      ? h("Chart", {
          type: "line",
          height: 36,
          yDomain: [0, 100],
          strokeWidth: 1.5,
          series: [{ color: PAL.blue, points: cpuSpark }],
        })
      : null,
    ...systems.slice(0, 5).flatMap((system, index) => {
      const info = system.info;
      const live = system.status === "up" && info;
      return [
        index ? h("Divider") : null,
        h(
          "Column",
          { gap: 4 },
          wRow(
            wText(system.name, { fontSize: 12, fontWeight: 600 }),
            wText(live ? uptime(info.u, lang) : statusWord(system.status, lang), {
              fontSize: 11,
              color: live ? "secondary" : wColor(statusTone(system.status)),
            }),
            6,
          ),
          live ? metricBarsGrid(info, lang) : null,
        ),
      ];
    }),
    systems.length > 5
      ? wText(t(lang, `另 ${systems.length - 5} 台`, `${systems.length - 5} more`), {
          fontSize: 11,
          color: "secondary",
        })
      : null,
    h("Spacer"),
  );
}

export function buildWidgets(
  ctx: SurfaceContext,
  knownEmpty: boolean,
): Record<Family, VNode> | undefined {
  if (knownEmpty) return undefined;
  const render = (family: Family) => {
    if (!ctx.configured) return overviewWidget(ctx, family);
    if (ctx.widgetMode === "system") return singleSystemWidget(ctx, family);
    if (ctx.widgetMode === "alerts") return alertsWidget(ctx, family);
    return overviewWidget(ctx, family);
  };
  return { small: render("small"), medium: render("medium"), large: render("large") };
}
