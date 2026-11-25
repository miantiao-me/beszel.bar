import { orderBy } from "es-toolkit";
import { formatRate, formatShortRate } from "../../beszel/format.ts";
import { systemBandwidthBytes } from "../../beszel/metrics.ts";
import { t } from "../../host/bridge.ts";
import { ICON_NAMES } from "../icons.ts";
import { h, Icon, T, type VNode } from "../kit.ts";
import { metricHex, PAL, statusDot } from "../theme.ts";
import type { SurfaceContext } from "./types.ts";

function notchKpi(
  key: string,
  label: string,
  value: string,
  hex: string,
  spark: { x: number; y: number }[],
  valueHex = "#ffffff",
): VNode {
  return h(
    "Column",
    {
      key,
      tw: "grow basis-0 min-w-0 rounded-[10px] bg-[#ffffff0b] border border-[#ffffff18] px-2.5 py-2 gap-0.5",
    },
    T(label, { tw: "text-[10px] font-medium text-[#ffffff80] truncate" }),
    T(value, {
      tw: `text-[13.5px] font-bold tabular-nums leading-tight truncate text-[${valueHex}]`,
    }),
    spark.length > 1
      ? h("Chart", {
          type: "area",
          height: 16,
          tw: "w-full h-[16px]",
          curve: "monotone",
          axes: false,
          grid: false,
          legend: false,
          hover: false,
          appear: false,
          strokeWidth: 1.5,
          series: [{ name: key, color: hex, fill: 0.2, points: spark }],
        })
      : null,
  );
}

export function buildNotch(
  ctx: SurfaceContext,
  mode: "compact" | "minimal" | "expanded" | undefined,
): Record<string, unknown> | undefined {
  if (!mode && !ctx.caps.notch) return undefined;
  const { lang, systems, fleetSummary: summary, attentionItems: attn, inboxUnreadKeys } = ctx;
  const totalAttn = attn.length + inboxUnreadKeys.size;
  const leading = h("Icon", {
    name: ICON_NAMES.server,
    width: 14,
    height: 14,
    fontSize: 14,
    textColor: "#ffffff",
  });

  let trailingText = "—";
  if (systems.length > 0) {
    if (summary.down > 0) trailingText = `${summary.down}↓`;
    else if (ctx.notchMetric === "cpu") trailingText = `${Math.round(summary.avgCpu)}%`;
    else if (ctx.notchMetric === "rate") {
      trailingText = formatShortRate(summary.totalBandwidthBytes);
    } else trailingText = `${summary.up}/${summary.total}`;
  }

  const result: Record<string, unknown> = {
    compact: {
      leading,
      trailing: T(trailingText, {
        fontSize: 11.5,
        fontWeight: 600,
        fontFeatures: "tnum",
        textColor: summary.down > 0 ? PAL.red : "#ffffff",
      }),
    },
    minimal: h("Icon", {
      name: ICON_NAMES.server,
      width: 13,
      height: 13,
      fontSize: 13,
      textColor: "#ffffff",
    }),
  };

  if (
    ctx.caps.notchActivity &&
    ctx.activeNotchActivity &&
    ctx.activeNotchActivity.expiresAt > Date.now()
  ) {
    result.activity = {
      id: ctx.activeNotchActivity.id,
      expiresAt: ctx.activeNotchActivity.expiresAt,
    };
  }

  if (mode !== "expanded" && mode !== undefined) return result;

  const cpuSpark = ctx.fleetHistory.map((p) => ({ x: p.ts, y: p.avgCpu }));
  const bwSpark = ctx.fleetHistory.map((p) => ({ x: p.ts, y: p.bandwidthBytes }));
  const hotNodes = orderBy(
    systems.filter((s) => s.status === "up" && s.info),
    [(s) => Math.max(s.info!.cpu, s.info!.mp, s.info!.dp)],
    ["desc"],
  ).slice(0, 3);
  const divider = () => h("Box", { tw: "w-full h-px bg-[#ffffff14] shrink-0" });

  const rows: (VNode | null)[] = attn.length
    ? attn.slice(0, 3).flatMap((item, idx) => [
        idx > 0 ? divider() : null,
        h(
          "ButtonBase",
          {
            key: `na-${item.id}`,
            label: item.title,
            onClick: () => ctx.onOpenSystem(item.systemId),
            tw: "flex-row items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-[#ffffff14] w-full",
          },
          statusDot(item.severity === "critical" ? PAL.red : PAL.yellow, 6),
          T(item.title, {
            tw: "text-[11.5px] font-semibold text-[#ffffff] truncate flex-1 min-w-0",
          }),
          T(item.detail, { tw: "text-[10px] text-[#ffffff80] truncate shrink-0" }),
        ),
      ])
    : hotNodes.length
      ? hotNodes.flatMap((s, idx) => {
          const info = s.info!;
          return [
            idx > 0 ? divider() : null,
            h(
              "ButtonBase",
              {
                key: `nh-${s.id}`,
                label: s.name,
                onClick: () => ctx.onOpenSystem(s.id),
                tw: "flex-row items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-[#ffffff14] w-full",
              },
              statusDot(PAL.green, 6),
              T(s.name, {
                tw: "text-[11.5px] font-medium text-[#ffffff] truncate flex-1 min-w-0",
              }),
              T(`CPU ${Math.round(info.cpu)}%`, {
                tw: `text-[10.5px] font-semibold tabular-nums w-[52px] text-right shrink-0 text-[${
                  info.cpu >= 65 ? metricHex(info.cpu) : "#ffffff"
                }]`,
              }),
              T(`MEM ${Math.round(info.mp)}%`, {
                tw: "text-[10px] tabular-nums text-[#ffffff80] w-[54px] text-right shrink-0",
              }),
              T(formatShortRate(systemBandwidthBytes(info)), {
                tw: "text-[10px] tabular-nums text-[#ffffff70] w-[42px] text-right shrink-0",
              }),
            ),
          ];
        })
      : [
          h(
            "Row",
            { tw: "px-2.5 py-2 w-full" },
            T(
              ctx.configured
                ? t(lang, "暂无在线主机", "No online servers")
                : t(lang, "请在设置中连接 Beszel", "Connect Beszel in settings"),
              { tw: "text-[11px] text-[#ffffff80]" },
            ),
          ),
        ];

  result.expanded = h(
    "Column",
    { width: 420, tw: "gap-2.5" },
    h(
      "Row",
      { tw: "items-center gap-2 w-full" },
      h(
        "Row",
        {
          tw: `items-center gap-1.5 px-2 py-0.5 rounded-full shrink-0 ${
            summary.down ? "bg-[#ef444428]" : "bg-[#3db86624]"
          }`,
        },
        statusDot(summary.down ? PAL.red : PAL.green, 5),
        T(ctx.verdictText, {
          tw: `text-[10.5px] font-semibold tabular-nums ${
            summary.down ? "text-[#fca5a5]" : "text-[#86efac]"
          }`,
        }),
      ),
      h("Spacer"),
      h(
        "ButtonBase",
        {
          key: "notch-refresh",
          label: t(lang, "刷新", "Refresh"),
          onClick: ctx.onRefresh,
          tw: "w-6 h-6 rounded-md items-center justify-center cursor-pointer hover:bg-[#ffffff18]",
        },
        Icon("refresh", 13, "#ffffffa0"),
      ),
    ),
    h(
      "Row",
      { tw: "items-stretch gap-2 w-full" },
      notchKpi(
        "nk-up",
        t(lang, "在线", "Online"),
        `${summary.up}/${summary.total}`,
        summary.down ? PAL.red : PAL.green,
        [],
        summary.down ? PAL.red : "#ffffff",
      ),
      notchKpi(
        "nk-bw",
        t(lang, "实时带宽", "Bandwidth"),
        formatRate(summary.totalBandwidthBytes, true),
        PAL.emerald,
        bwSpark,
      ),
      notchKpi(
        "nk-cpu",
        t(lang, "平均 CPU", "Avg CPU"),
        summary.up > 0 ? `${Math.round(summary.avgCpu)}%` : "—",
        metricHex(summary.avgCpu, PAL.blue),
        cpuSpark,
        summary.avgCpu >= 65 ? metricHex(summary.avgCpu) : "#ffffff",
      ),
    ),
    h(
      "Column",
      { tw: "gap-1 w-full" },
      h(
        "Row",
        { tw: "items-center w-full px-0.5" },
        T(attn.length ? t(lang, "当前异常", "Active Alerts") : t(lang, "负载排行", "Top Servers"), {
          tw: `text-[10px] font-semibold ${attn.length ? "text-[#eab308]" : "text-[#ffffff73]"}`,
        }),
        h("Spacer"),
        T(
          totalAttn > 0
            ? t(lang, `${totalAttn} 项告警`, `${totalAttn} alerts`)
            : t(lang, "全部正常", "All clear"),
          { tw: "text-[10px] tabular-nums text-[#ffffff66]" },
        ),
      ),
      h(
        "Column",
        { tw: "w-full rounded-[10px] bg-[#ffffff0a] border border-[#ffffff16] overflow-hidden" },
        ...rows,
      ),
    ),
  );
  return result;
}
