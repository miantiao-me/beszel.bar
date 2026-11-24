import type { SortKey } from "../../beszel/types.ts";
import { t } from "../../host/bridge.ts";
import { clock, h, Icon, T, type VNode } from "../kit.ts";
import { ghostIconButton, PAL, statusDot } from "../theme.ts";
import type { PanelActions, PanelState } from "./types.ts";

function sortMenuButton(state: PanelState, actions: PanelActions): VNode {
  const { lang, sortKey, sortDesc } = state;
  const dir = sortDesc ? " ↓" : " ↑";
  const choices: { value: SortKey; label: string }[] = [
    { value: "severity", label: t(lang, "状态优先", "State") },
    { value: "cpu", label: "CPU" },
    { value: "mem", label: t(lang, "内存", "Memory") },
    { value: "disk", label: t(lang, "磁盘", "Disk") },
    { value: "net", label: t(lang, "网速", "Network") },
    { value: "name", label: t(lang, "名称", "Name") },
  ];
  const shortLabel: Record<SortKey, string> = {
    severity: t(lang, "状态", "State"),
    cpu: `CPU${dir}`,
    mem: `${t(lang, "内存", "MEM")}${dir}`,
    disk: `${t(lang, "磁盘", "DSK")}${dir}`,
    net: `${t(lang, "网速", "Net")}${dir}`,
    name: `${t(lang, "名称", "Name")}${dir}`,
  };
  return h("MenuButton", {
    key: "sort-menu",
    label: shortLabel[sortKey],
    tooltip: t(lang, "排序方式", "Sort servers"),
    fontSize: 11,
    height: 24,
    paddingX: 6,
    paddingY: 0,
    background: "#00000000",
    border: [0, "border"],
    menu: choices.map((choice) => ({
      label:
        choice.value === sortKey && choice.value !== "severity"
          ? `${choice.label}${dir}`
          : choice.label,
      radio: true,
      checked: sortKey === choice.value,
      onClick: () => actions.onSetSort(choice.value),
    })),
  });
}

export function topHeader(
  state: PanelState,
  actions: PanelActions,
  alertsBadge?: { show: boolean; count: number },
): VNode {
  const { lang, currentLayout } = state;
  const showSortMenu = currentLayout === "cards" && state.systems.length > 1;
  const hasBgError = Boolean(state.errorKind && state.systems.length > 0);
  const badgeText = hasBgError
    ? t(lang, "更新失败", "Sync error")
    : state.stale
      ? t(lang, `过期 · ${clock(state.updatedAt)}`, `Stale · ${clock(state.updatedAt)}`)
      : state.isInitialLoading
        ? t(lang, "连接中", "Syncing")
        : "";

  return h(
    "Row",
    { tw: "items-center gap-2 w-full shrink-0 px-3.5 pt-3 pb-2" },
    Icon("server", 16, "text"),
    T("Beszel", { tw: "text-[14px] font-semibold shrink-0" }),
    badgeText
      ? h(
          "Row",
          {
            tw: `items-center gap-1 px-2 py-0.5 rounded-full shrink-0 ${
              hasBgError ? "bg-[#ef44441f]" : state.stale ? "bg-[#eab3081f]" : "bg-surfaceHover"
            }`,
          },
          statusDot(hasBgError ? PAL.red : state.stale ? PAL.yellow : PAL.muted, 5),
          T(badgeText, {
            tw: `text-[10px] font-medium tabular-nums ${
              hasBgError ? "text-[#ef4444]" : state.stale ? "text-[#eab308]" : "text-textMuted"
            }`,
          }),
        )
      : null,
    h("Spacer"),
    showSortMenu ? sortMenuButton(state, actions) : null,
    alertsBadge?.show
      ? ghostIconButton("bell", () => actions.onSetView("alerts"), {
          key: "header-alerts",
          tooltip:
            alertsBadge.count > 0
              ? t(lang, `告警 (${alertsBadge.count})`, `Alerts (${alertsBadge.count})`)
              : t(lang, "告警", "Alerts"),
          color: alertsBadge.count > 0 ? "text" : "textMuted",
        })
      : null,
    state.systems.length > 0
      ? ghostIconButton(currentLayout === "cards" ? "list" : "grid", actions.onToggleLayout, {
          key: "toggle-layout",
          tooltip:
            currentLayout === "cards"
              ? t(lang, "表格视图", "Table view")
              : t(lang, "卡片视图", "Card view"),
        })
      : null,
    state.configured
      ? ghostIconButton("refresh", actions.onRefresh, {
          key: "header-refresh",
          tooltip: state.updatedAt
            ? t(lang, `刷新 · ${clock(state.updatedAt)}`, `Refresh · ${clock(state.updatedAt)}`)
            : t(lang, "刷新", "Refresh"),
          disabled: state.refreshing,
          spinning: state.refreshing,
        })
      : null,
    state.configured && state.serverUrl
      ? ghostIconButton("external", () => actions.onOpenBeszel(), {
          key: "header-open",
          tooltip: t(lang, "打开 Beszel", "Open Beszel"),
        })
      : null,
  );
}
