import { formatRate, statusTone, statusWord, uptime } from "../../beszel/format.ts";
import { systemBandwidthBytes, systemLoad } from "../../beszel/metrics.ts";
import type { SortKey, SystemRecord } from "../../beszel/types.ts";
import { t, type Lang } from "../../host/bridge.ts";
import { h, T, type VNode } from "../kit.ts";
import {
  cardClass,
  hairline,
  kpiTile,
  metricHex,
  metricTextClass,
  PAL,
  pill,
  slimBar,
  statusDot,
  toneColorHex,
} from "../theme.ts";
import type { PanelActions, PanelState } from "./types.ts";

function fleetKpiStrip(state: PanelState): VNode {
  const { lang, fleetSummary: summary } = state;
  const cpuSpark = state.fleetHistory.map((p) => ({ x: p.ts, y: p.avgCpu }));
  const bwSpark = state.fleetHistory.map((p) => ({ x: p.ts, y: p.bandwidthBytes }));
  const onlineTint = summary.down > 0 ? PAL.red : summary.pending > 0 ? PAL.yellow : PAL.green;

  return h(
    "Row",
    { tw: "w-full gap-2 px-3.5 pb-2 shrink-0 items-stretch" },
    kpiTile({
      key: "kpi-online",
      label: t(lang, "在线", "Online"),
      value: `${summary.up}/${summary.total}`,
      valueHex:
        summary.down > 0
          ? PAL.red
          : summary.total > 0 && summary.up === summary.total
            ? PAL.green
            : undefined,
      tintHex: onlineTint,
    }),
    kpiTile({
      key: "kpi-bw",
      label: t(lang, "实时带宽", "Bandwidth"),
      value: formatRate(summary.totalBandwidthBytes, true),
      tintHex: PAL.emerald,
      sparkPoints: bwSpark,
    }),
    kpiTile({
      key: "kpi-cpu",
      label: t(lang, "平均 CPU", "Avg CPU"),
      value: summary.up > 0 ? `${Math.round(summary.avgCpu)}%` : "—",
      valueHex: summary.avgCpu >= 65 ? metricHex(summary.avgCpu) : undefined,
      tintHex: metricHex(summary.avgCpu, PAL.blue),
      sparkPoints: cpuSpark,
    }),
  );
}

function searchBar(state: PanelState, actions: PanelActions): VNode | null {
  if (state.systems.length <= 6 && !state.searchQuery) return null;
  return h(
    "Row",
    { tw: "w-full px-3.5 pb-2 shrink-0" },
    h("SearchField", {
      key: "system-search",
      value: state.searchQuery,
      placeholder: t(state.lang, "搜索主机…", "Search servers…"),
      onChange: (value: string) => actions.onSetSearch(value),
    }),
  );
}

function cardMetricCell(label: string, value: number): VNode {
  return h(
    "Column",
    { tw: "flex-1 min-w-0 gap-1" },
    h(
      "Row",
      { tw: "items-center gap-1" },
      T(label, { tw: "text-[9.5px] font-medium text-textMuted shrink-0" }),
      h("Spacer"),
      T(`${Math.round(value)}%`, {
        tw: `text-[11px] font-semibold tabular-nums ${metricTextClass(value)}`,
      }),
    ),
    slimBar(value, metricHex(value, PAL.green), 3.5),
  );
}

function systemCard(
  system: SystemRecord,
  lang: Lang,
  actions: PanelActions,
  selected: boolean,
): VNode {
  const info = system.info;
  const live = system.status === "up" && Boolean(info);
  const tone = statusTone(system.status);
  const bw = live ? systemBandwidthBytes(info) : null;
  const load = live ? systemLoad(info) : null;
  const hasFailedSv = live && Boolean(info?.sv && info.sv[1] > 0);

  return h(
    "ButtonBase",
    {
      key: `system-${system.id}`,
      label: system.name,
      tooltip: t(lang, "查看详情", "View details"),
      onClick: () => actions.onOpenDetail(system.id),
      tw: `${cardClass("p-2.5 gap-2 min-w-0 flex-col items-start cursor-pointer hover:bg-surfaceHover")} ${
        selected ? "border-[#2662d9] bg-surfaceHover" : ""
      }`,
    },
    h(
      "Row",
      { tw: "items-center gap-1.5 w-full min-w-0" },
      statusDot(toneColorHex(tone), 7),
      T(system.name, { tw: "text-[12.5px] font-semibold truncate flex-1 min-w-0" }),
      hasFailedSv ? pill(`${info!.sv![1]}!`, PAL.red) : null,
    ),
    ...(live && info
      ? [
          h(
            "Row",
            { tw: "gap-2 w-full" },
            cardMetricCell("CPU", info.cpu),
            cardMetricCell(t(lang, "内存", "MEM"), info.mp),
            cardMetricCell(t(lang, "磁盘", "DSK"), info.dp),
          ),
          h(
            "Row",
            { tw: "items-center gap-1.5 w-full" },
            T(bw !== null ? formatRate(bw, true) : uptime(info.u, lang), {
              tw: "text-[10px] text-textMuted tabular-nums truncate",
            }),
            info.dt !== undefined && Number.isFinite(info.dt)
              ? T(`${Math.round(info.dt)}°C`, {
                  tw: `text-[10px] tabular-nums shrink-0 ${
                    info.dt >= 85 ? "text-[#ef4444]" : "text-textMuted"
                  }`,
                })
              : null,
            h("Spacer"),
            T(load ? `L ${load[0].toFixed(2)}` : uptime(info.u, lang), {
              tw: "text-[10px] text-textMuted tabular-nums shrink-0",
            }),
          ),
        ]
      : [
          h(
            "Column",
            { tw: "items-start gap-1 py-1.5 w-full min-w-0" },
            T(statusWord(system.status, lang), {
              tw: `text-[11.5px] font-medium text-[${toneColorHex(tone)}]`,
            }),
            T(system.host || info?.h || "—", { tw: "text-[10px] text-textMuted truncate" }),
          ),
        ]),
  );
}

function tableHeaderCell(
  label: string,
  sortKey: SortKey,
  state: PanelState,
  actions: PanelActions,
  widthClass: string,
  alignEnd = true,
): VNode {
  const active = state.sortKey === sortKey;
  const arrow = active ? (state.sortDesc ? " ↓" : " ↑") : "";
  return h(
    "ButtonBase",
    {
      label,
      onClick: () => actions.onSetSort(sortKey),
      tw: `${widthClass} cursor-pointer rounded px-1 py-0.5 hover:bg-surfaceHover ${
        alignEnd ? "justify-end" : "justify-start"
      }`,
    },
    T(`${label}${arrow}`, {
      tw: `text-[10.5px] tabular-nums ${
        active ? "font-semibold text-text" : "font-medium text-textMuted"
      }`,
    }),
  );
}

function systemTable(
  list: SystemRecord[],
  state: PanelState,
  actions: PanelActions,
  selectedId: string | null,
): VNode {
  const { lang } = state;
  return h(
    "Column",
    { tw: `${cardClass("overflow-hidden")} w-full` },
    h(
      "Row",
      { tw: "items-center gap-1.5 px-2.5 py-1.5 w-full" },
      tableHeaderCell(t(lang, "主机", "Server"), "name", state, actions, "flex-1 min-w-0", false),
      tableHeaderCell("CPU", "cpu", state, actions, "w-[44px] shrink-0"),
      tableHeaderCell(t(lang, "内存", "MEM"), "mem", state, actions, "w-[44px] shrink-0"),
      tableHeaderCell(t(lang, "磁盘", "DSK"), "disk", state, actions, "w-[44px] shrink-0"),
      tableHeaderCell(t(lang, "网速", "Net"), "net", state, actions, "w-[62px] shrink-0"),
    ),
    hairline(),
    ...list.flatMap((system, idx) => {
      const info = system.info;
      const live = system.status === "up" && Boolean(info);
      const tone = statusTone(system.status);
      const bw = live ? systemBandwidthBytes(info) : null;
      return [
        idx > 0 ? hairline() : null,
        h(
          "ButtonBase",
          {
            key: `system-${system.id}`,
            label: system.name,
            tooltip: t(lang, "查看详情", "View details"),
            onClick: () => actions.onOpenDetail(system.id),
            tw: `flex-row items-center gap-1.5 px-2.5 py-2 w-full min-w-0 cursor-pointer hover:bg-surfaceHover ${
              selectedId === system.id ? "bg-surfaceHover" : ""
            }`,
          },
          statusDot(toneColorHex(tone), 6),
          T(system.name, { tw: "flex-1 min-w-0 text-[12px] font-medium truncate" }),
          live && info
            ? [
                T(`${Math.round(info.cpu)}%`, {
                  tw: `w-[44px] text-right text-[11.5px] font-medium tabular-nums shrink-0 ${metricTextClass(info.cpu)}`,
                }),
                T(`${Math.round(info.mp)}%`, {
                  tw: `w-[44px] text-right text-[11.5px] font-medium tabular-nums shrink-0 ${metricTextClass(info.mp)}`,
                }),
                T(`${Math.round(info.dp)}%`, {
                  tw: `w-[44px] text-right text-[11.5px] font-medium tabular-nums shrink-0 ${metricTextClass(info.dp)}`,
                }),
                T(formatRate(bw, true), {
                  tw: "w-[62px] text-right text-[11px] text-textMuted tabular-nums shrink-0",
                }),
              ]
            : T(statusWord(system.status, lang), {
                tw: `text-[11px] font-medium text-right shrink-0 text-[${toneColorHex(tone)}]`,
              }),
        ),
      ];
    }),
  );
}

export function fleetListPane(state: PanelState, actions: PanelActions): VNode {
  const { lang, isWide, currentLayout, sortedSystems: sorted, selectedSystem } = state;
  const listContent = sorted.length
    ? currentLayout === "cards"
      ? h(
          "Grid",
          { columns: 2, gap: 8, tw: "w-full" },
          ...sorted.map((system) =>
            systemCard(system, lang, actions, selectedSystem?.id === system.id),
          ),
        )
      : systemTable(sorted, state, actions, selectedSystem?.id ?? null)
    : h(
        "Column",
        { tw: `${cardClass("p-4 items-center")} w-full` },
        T(
          state.systems.length
            ? t(lang, "无匹配主机", "No matching servers")
            : state.isInitialLoading
              ? t(lang, "加载中…", "Loading…")
              : t(lang, "暂无主机", "No servers yet"),
          { tw: "text-[11.5px] text-textMuted" },
        ),
      );

  return h(
    "Column",
    {
      ...(isWide ? { fillHeight: true } : {}),
      tw: isWide ? "w-[440px] shrink-0 min-h-0" : "flex-1 min-w-0 min-h-0",
    },
    fleetKpiStrip(state),
    searchBar(state, actions),
    h("Scroll", { tw: "flex-1 min-h-0" }, h("Column", { tw: "px-3.5 pb-3.5 gap-2" }, listContent)),
  );
}
