import { t } from "../../host/bridge.ts";
import { h, Icon, T, type Child, type VNode } from "../kit.ts";
import { cardClass } from "../theme.ts";
import { alertsContent } from "./alerts.ts";
import { detailContent } from "./detail.ts";
import { fleetListPane } from "./fleet.ts";
import { topHeader } from "./header.ts";
import { FLYOUT_HEIGHT, FLYOUT_WIDTH, type PanelActions, type PanelState } from "./types.ts";

export type { PanelActions, PanelState };

function panelShell(
  state: PanelState,
  shortcuts: Record<string, () => void>,
  allowWide: boolean,
  ...children: Child[]
): VNode {
  const wide = allowWide && state.isWide;
  return h(
    "Column",
    {
      preferredWidth: wide ? Math.min(1080, state.viewportWidth) : FLYOUT_WIDTH,
      preferredHeight: wide ? Math.max(560, state.viewportHeight || 620) : FLYOUT_HEIGHT,
      safeArea: true,
      tw: "size-full min-w-0 min-h-0 text-text bg-background",
      shortcuts,
    },
    ...children,
  );
}

function setupOrErrorCard(state: PanelState, actions: PanelActions, failed: boolean): VNode {
  const { lang } = state;
  return h(
    "Column",
    { tw: "flex-1 min-h-0 items-center justify-center px-6 pb-6" },
    h(
      "Column",
      {
        tw: `${cardClass("p-5 gap-2.5 items-center w-full")} ${failed ? "border-[#ef444444]" : ""}`,
      },
      h(
        "Box",
        { width: 36, height: 36, radius: 10, background: "surfaceHover", center: true },
        Icon(failed ? "alert" : "server", 18, "text"),
      ),
      T(
        failed ? t(lang, "连接失败", "Couldn't connect") : t(lang, "连接 Beszel", "Connect Beszel"),
        { tw: "text-[14px] font-semibold text-center" },
      ),
      T(
        failed
          ? `${state.errorMessage}${state.errorDetail && state.errorKind !== "http" ? `\n${state.errorDetail}` : ""}`
          : t(
              lang,
              "在设置中填写 Beszel 地址与账号即可开始。",
              "Enter your Beszel URL and account in settings.",
            ),
        { tw: "text-[11.5px] text-textMuted text-center leading-snug" },
      ),
      failed
        ? h("Button", { text: t(lang, "重试", "Retry"), onClick: actions.onRefresh, tw: "mt-1" })
        : null,
    ),
  );
}

export function renderPanel(state: PanelState, actions: PanelActions): VNode {
  const { screen, lang, isWide, selectedSystem } = state;
  const shortcuts = {
    "CmdOrCtrl+R": actions.onRefresh,
    Escape: () => {
      if (screen.kind === "detail") actions.onCloseDetail();
      else if (screen.kind === "alerts") actions.onSetView("systems");
      else if (state.searchQuery) actions.onSetSearch("");
    },
  };

  switch (screen.kind) {
    case "setup":
    case "error":
      return panelShell(
        state,
        { "CmdOrCtrl+R": actions.onRefresh },
        false,
        topHeader(state, actions),
        setupOrErrorCard(state, actions, screen.kind === "error"),
      );

    case "detail":
      return panelShell(
        state,
        shortcuts,
        false,
        ...detailContent(screen.system, state, actions, true),
      );

    case "alerts":
      return panelShell(state, shortcuts, true, ...alertsContent(state, actions));

    case "fleet": {
      const totalAlerts = state.attentionItems.length + state.inboxUnreadKeys.size;
      const showAlertsBell =
        totalAlerts > 0 || state.inboxAlerts.length > 0 || state.inboxBoundCount > 0;
      const listPane = fleetListPane(state, actions);

      return panelShell(
        state,
        shortcuts,
        true,
        topHeader(state, actions, { show: showAlertsBell, count: totalAlerts }),
        isWide
          ? h(
              "Row",
              { tw: "flex-1 min-h-0 w-full" },
              listPane,
              h("Box", { width: 1, fillHeight: true, tw: "bg-border shrink-0" }),
              selectedSystem
                ? h(
                    "Column",
                    { tw: "flex-1 min-w-0 min-h-0 size-full" },
                    ...detailContent(selectedSystem, state, actions, false),
                  )
                : h(
                    "Column",
                    { tw: "flex-1 items-center justify-center p-6" },
                    T(t(lang, "选择主机查看详情", "Select a server to view details"), {
                      tw: "text-[12px] text-textMuted",
                    }),
                  ),
            )
          : listPane,
      );
    }
  }
}
