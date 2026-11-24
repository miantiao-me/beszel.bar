import type { AttentionItem } from "../../beszel/types.ts";
import { t, type Lang } from "../../host/bridge.ts";
import type { InboxAlert } from "../../inbox/parser.ts";
import { ago, h, T, type Child, type VNode } from "../kit.ts";
import { cardClass, ghostIconButton, hairline, PAL, sectionHeading, statusDot } from "../theme.ts";
import type { PanelActions, PanelState } from "./types.ts";

function attentionSection(items: AttentionItem[], actions: PanelActions, lang: Lang): Child[] {
  if (!items.length) return [];
  return [
    sectionHeading(t(lang, `当前异常 · ${items.length}`, `Active · ${items.length}`)),
    h(
      "Column",
      { tw: `${cardClass("overflow-hidden")} w-full` },
      ...items.flatMap((item, idx) => {
        const hex = item.severity === "critical" ? PAL.red : PAL.yellow;
        return [
          idx > 0 ? hairline() : null,
          h(
            "ButtonBase",
            {
              key: `attn-${item.id}`,
              label: item.title,
              onClick: () => {
                actions.onSetView("systems");
                actions.onOpenDetail(item.systemId);
              },
              tw: "flex-row items-center gap-2 px-3 py-2 w-full min-w-0 cursor-pointer hover:bg-surfaceHover",
            },
            statusDot(hex, 6),
            T(item.title, { tw: "text-[12px] font-medium flex-1 min-w-0 truncate" }),
            T(item.detail, {
              tw: `text-[11px] font-medium tabular-nums shrink-0 text-[${hex}]`,
            }),
          ),
        ];
      }),
    ),
  ];
}

function inboxRow(alert: InboxAlert, state: PanelState, actions: PanelActions): VNode {
  const { lang } = state;
  const unread = state.inboxUnreadKeys.has(alert.key);
  const expanded = state.expandedInboxKey === alert.key;
  const itemOp = state.inboxBusy[alert.key];
  const hex =
    alert.severity === "critical" ? PAL.red : alert.severity === "info" ? PAL.green : PAL.yellow;
  const ageText = alert.receivedAt ? ago(alert.receivedAt * 1000, lang) : "";

  return h(
    "Column",
    { key: `inbox-${alert.key}`, tw: "w-full" },
    h(
      "Row",
      { tw: "items-center gap-1.5 px-3 py-2 w-full" },
      h(
        "ButtonBase",
        {
          key: `inbox-open-${alert.key}`,
          label: alert.title,
          onClick: () => actions.onToggleInboxExpand(alert),
          tw: "flex-row items-center gap-2 flex-1 min-w-0 cursor-pointer",
        },
        statusDot(unread ? hex : PAL.muted, 6),
        T(alert.title, {
          tw: `text-[12px] flex-1 min-w-0 truncate ${unread ? "font-semibold" : "font-normal text-textMuted"}`,
        }),
        ageText ? T(ageText, { tw: "text-[10.5px] text-textMuted tabular-nums shrink-0" }) : null,
      ),
      state.canInboxRemove
        ? ghostIconButton("trash", () => actions.onDeleteInbox(alert), {
            key: `inbox-del-${alert.key}`,
            tooltip: t(lang, "删除", "Delete"),
            disabled: itemOp === "deleting",
            size: 22,
            iconSize: 12,
          })
        : null,
    ),
    expanded
      ? h(
          "Column",
          { tw: "px-3 pb-2.5 pl-6 w-full" },
          itemOp === "loading"
            ? T(t(lang, "加载中…", "Loading…"), { tw: "text-[11px] text-textMuted" })
            : T(alert.body || alert.title, {
                selectable: true,
                tw: "text-[11px] text-textMuted leading-snug",
              }),
        )
      : null,
  );
}

function inboxSection(state: PanelState, actions: PanelActions): Child[] {
  const { lang, inboxAlerts, inboxBoundCount } = state;
  if (inboxBoundCount === 0 && inboxAlerts.length === 0) return [];
  return [
    sectionHeading(
      inboxAlerts.length
        ? t(lang, `告警消息 · ${inboxAlerts.length}`, `Messages · ${inboxAlerts.length}`)
        : t(lang, "告警消息", "Messages"),
    ),
    inboxAlerts.length
      ? h(
          "Column",
          { tw: `${cardClass("overflow-hidden")} w-full` },
          ...inboxAlerts
            .slice(0, 20)
            .flatMap((item, idx) => [idx > 0 ? hairline() : null, inboxRow(item, state, actions)]),
        )
      : h(
          "Row",
          { tw: `${cardClass("px-3 py-2.5")} items-center w-full` },
          T(t(lang, "暂无告警消息", "No messages"), { tw: "text-[11.5px] text-textMuted" }),
        ),
  ];
}

/** Returns [header, scroll] directly into the root panel Column without an extra wrapper. */
export function alertsContent(state: PanelState, actions: PanelActions): VNode[] {
  const { lang, attentionItems, inboxAlerts, inboxBoundCount } = state;
  const empty = attentionItems.length === 0 && inboxAlerts.length === 0 && inboxBoundCount === 0;

  return [
    h(
      "Row",
      { tw: "items-center gap-2 w-full px-3.5 pt-3 pb-2 shrink-0" },
      ghostIconButton("back", () => actions.onSetView("systems"), {
        key: "alerts-back",
        tooltip: t(lang, "返回", "Back"),
      }),
      T(t(lang, "告警", "Alerts"), { tw: "text-[14px] font-semibold truncate flex-1 min-w-0" }),
      ghostIconButton(
        "refresh",
        () => {
          actions.onRefresh();
          actions.onRefreshInbox();
        },
        {
          key: "alerts-refresh",
          tooltip: t(lang, "刷新", "Refresh"),
          disabled: state.refreshing,
          spinning: state.refreshing,
        },
      ),
      state.serverUrl
        ? ghostIconButton("external", () => actions.onOpenBeszel(), {
            key: "alerts-open",
            tooltip: t(lang, "打开 Beszel", "Open Beszel"),
          })
        : null,
    ),
    h(
      "Scroll",
      { tw: "flex-1 min-h-0" },
      h(
        "Column",
        { tw: "px-3.5 pb-3.5 gap-2.5" },
        empty
          ? h(
              "Row",
              { tw: `${cardClass("px-3 py-2.5")} items-center gap-2 w-full` },
              statusDot(PAL.green, 7),
              T(t(lang, "所有主机运行平稳", "All servers healthy"), {
                tw: "text-[11.5px] text-textMuted",
              }),
            )
          : [...attentionSection(attentionItems, actions, lang), ...inboxSection(state, actions)],
      ),
    ),
  ];
}
