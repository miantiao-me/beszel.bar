import { formatRate, formatShortRate } from "../../beszel/format.ts";
import { t } from "../../host/bridge.ts";
import { ICON_NAMES, SERVER_SVG } from "../icons.ts";
import { h, type VNode } from "../kit.ts";
import type { SurfaceContext } from "./types.ts";

interface TrayItem {
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

function buildTrayTitle(ctx: SurfaceContext): string {
  const { lang, systems, fleetSummary: summary, configured, errorKind, trayFormat } = ctx;
  if (!systems.length) return configured && !errorKind ? "0" : "—";
  if (summary.down > 0 && trayFormat !== "cpu" && trayFormat !== "cpu_spark") {
    return t(lang, `${summary.down} 离线`, `${summary.down} down`);
  }
  if (trayFormat === "online") return `${summary.up}/${summary.total}`;
  if (trayFormat === "cpu" || trayFormat === "cpu_spark") {
    return summary.up > 0 ? `CPU ${Math.round(summary.avgCpu)}%` : `${summary.up}/${summary.total}`;
  }
  const bw = formatRate(summary.totalBandwidthBytes, true);
  return summary.totalBandwidthBytes > 0
    ? `${summary.up}/${summary.total} · ${bw}`
    : `${summary.up}/${summary.total}`;
}

function buildTrayContent(ctx: SurfaceContext, fallbackTitle: string): VNode | undefined {
  if (!ctx.caps.trayContent) return undefined;
  const { trayFormat, fleetHistory, systems, fleetSummary: summary } = ctx;
  if ((trayFormat !== "rate_spark" && trayFormat !== "cpu_spark") || !systems.length) {
    return undefined;
  }

  const isCpu = trayFormat === "cpu_spark";
  const pts = fleetHistory.slice(-24).map((sample, idx) => ({
    x: idx,
    y: isCpu ? Math.round(sample.avgCpu) : Math.round(sample.bandwidthBytes / 1024),
  }));
  const icon = ctx.caps.trayContentIcon
    ? h("Icon", { svg: SERVER_SVG, width: 15, height: 15, fontSize: 15 })
    : null;
  const label = isCpu
    ? summary.up > 0
      ? `${Math.round(summary.avgCpu)}%`
      : fallbackTitle
    : summary.down > 0
      ? `${summary.down}↓`
      : formatShortRate(summary.totalBandwidthBytes);
  const spark =
    pts.length > 1
      ? h("Chart", {
          type: "line",
          width: 36,
          height: 18,
          strokeWidth: 1.4,
          series: [{ name: isCpu ? "cpu" : "bw", points: pts }],
        })
      : null;
  const width = Math.min(220, (icon ? 20 : 0) + 46 + (spark ? 40 : 0));
  return h(
    "Row",
    { width, height: 22, gap: 4, alignItems: "center" },
    icon,
    h("Text", { text: label, fontSize: 12, fontWeight: 500 }),
    spark,
  );
}

export function buildTray(ctx: SurfaceContext): Record<string, unknown> {
  const { lang, fleetSummary: summary, configured, errorKind, errorMessage, stale } = ctx;
  const title = buildTrayTitle(ctx);
  const menu: TrayItem[] = ctx.serverUrl
    ? [{ label: t(lang, "打开 Beszel", "Open Beszel"), onClick: ctx.onOpenBeszel }]
    : [];

  const tooltip = summary.total
    ? t(
        lang,
        `Beszel · ${summary.up}/${summary.total} 在线${summary.down ? `（${summary.down} 离线）` : ""} · CPU ${Math.round(summary.avgCpu)}% · ${formatRate(summary.totalBandwidthBytes, true)}${stale ? " · 已过期" : ""}`,
        `Beszel · ${summary.up}/${summary.total} up${summary.down ? ` (${summary.down} down)` : ""} · CPU ${Math.round(summary.avgCpu)}% · ${formatRate(summary.totalBandwidthBytes, true)}${stale ? " · stale" : ""}`,
      )
    : errorMessage ||
      (configured
        ? t(lang, "Beszel · 暂无主机", "Beszel · no servers")
        : t(lang, "Beszel · 未连接", "Beszel · not connected"));

  const tray: Record<string, unknown> = {
    icon: ICON_NAMES.server,
    iconTemplate: true,
    error:
      errorKind && errorKind !== "config"
        ? errorMessage
        : stale
          ? t(lang, "数据已过期", "Data is stale")
          : "",
    title,
    tooltip,
    ...(menu.length ? { menu } : {}),
  };
  const rich = buildTrayContent(ctx, title);
  if (rich) tray.content = rich;
  return tray;
}
