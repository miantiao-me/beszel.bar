import { computed } from "vue";
import { classifyApiError, createBeszelClient } from "./beszel/client.ts";
import { createDetailLoader } from "./beszel/detail-loader.ts";
import { buildSystemSummaryText } from "./beszel/format.ts";
import { sortSystems, summarizeFleet } from "./beszel/metrics.ts";
import type { AlertRecord, SystemRecord } from "./beszel/types.ts";
import { createAlertMonitor } from "./domain/alerts.ts";
import {
  copyToClipboard,
  invalidateHost,
  openHostPanel,
  openHostUrl,
  scheduleHost,
  type Env,
} from "./host/bridge.ts";
import { createInboxService } from "./inbox/service.ts";
import { createBeszelStore } from "./store.ts";
import { renderPanel, type PanelActions } from "./ui/panel/index.ts";
import { buildNotch } from "./ui/surfaces/notch.ts";
import { buildTray } from "./ui/surfaces/tray.ts";
import type { SurfaceContext, View } from "./ui/surfaces/types.ts";
import { buildWidgets } from "./ui/surfaces/widgets.ts";

const FLEET_HISTORY_LIMIT = 48;

let refreshVersion = 0;
let networkOnline = true;
let capsProbed = false;
let copyTimer: ReturnType<typeof setTimeout> | null = null;
let reactiveWired = false;

const store = createBeszelStore(() => {
  refreshVersion++;
  capsProbed = false;
  client.reset();
  detailLoader.clear();
  inbox.reset();
  alertMonitor.reset();
});

const client = createBeszelClient(() => ({
  baseUrl: store.serverUrl.value,
  email: store.credentialsRef.value.email,
  password: store.credentialsRef.value.password,
}));

const detailLoader = createDetailLoader(client, {
  getConnectionKey: () => store.connectionKey.value,
  getActiveTarget: () => ({ id: store.detailIdRef.value, period: store.historyPeriodRef.value }),
  hasSystem: (id) => store.systemsRef.value.some((s) => s.id === id),
  getLang: () => store.lang.value,
  getCurrentDetail: () => store.detailRef.value,
  setDetail: (detail) => {
    store.detailRef.value = detail;
  },
  setLoading: (loading) => {
    store.detailLoadingRef.value = loading;
  },
  onError: (kind, detail) => store.setError(kind, detail),
});

const alertMonitor = createAlertMonitor({
  canNotchActivity: () => store.capsRef.value.notchActivity,
  canNotchSetState: () => store.capsRef.value.notchSetState,
  setNotchActivity: (activity) => {
    store.activeNotchActivityRef.value = activity;
  },
  onNotificationClick: handleNotificationTag,
});

const inbox = createInboxService({
  getLang: () => store.lang.value,
  getCaps: () => store.capsRef.value,
  syncInboxCaps: () => store.syncCapabilities("inbox"),
  getSystems: () => store.systemsRef.value,
  getAlerts: () => store.inboxAlertsRef.value,
  setAlerts: (alerts) => {
    store.inboxAlertsRef.value = alerts;
  },
  setBoundCount: (count) => {
    store.inboxBoundCountRef.value = count;
  },
  getReadKeys: () => store.inboxReadKeysRef.value,
  deleteReadKey: store.deleteInboxReadKey,
  getExpandedKey: () => store.expandedInboxKeyRef.value,
  setExpandedKey: (key) => {
    store.expandedInboxKeyRef.value = key;
  },
  getBusyMap: () => store.inboxBusyRef.value,
  setItemBusy: store.setInboxItemBusy,
  onNewAlert: (alert) =>
    alertMonitor.processInboxAlert(alert, store.notifyEnabled.value, store.lang.value),
});

function openDetail(id: string): void {
  store.detailIdRef.value = id;
  void detailLoader.open(id, store.historyPeriodRef.value);
}

function openFromSurface(target: { systemId?: string; view?: "systems" | "alerts" }): void {
  if (target.view) store.activeViewRef.value = target.view;
  if (target.systemId) {
    store.activeViewRef.value = "systems";
    openDetail(target.systemId);
  }
  openHostPanel();
}

function handleNotificationTag(tag: string): void {
  if (tag.startsWith("beszel-sys-")) {
    const systemId = tag.slice("beszel-sys-".length).split(":")[0];
    if (systemId) openFromSurface({ systemId });
  } else if (tag.startsWith("beszel-inbox-")) {
    openFromSurface({ view: "alerts" });
  }
}

async function refresh(): Promise<void> {
  if (store.refreshingRef.value) return;
  const run = ++refreshVersion;
  const conn = store.connectionKey.value;
  store.refreshingRef.value = true;
  store.setError("");

  if (!store.configured.value) {
    store.setError("config");
    store.refreshingRef.value = false;
    return;
  }

  try {
    const [systemsRes, alertsRes] = await Promise.all([
      client.get<{ items: SystemRecord[] }>("/api/collections/systems/records", {
        perPage: 100,
        skipTotal: 1,
        sort: "name",
      }),
      client.optionalGet<{ items: AlertRecord[] }>(
        "/api/collections/alerts/records",
        { items: [] },
        { perPage: 100, skipTotal: 1, fields: "id,system,name,triggered,value,min" },
      ),
    ]);
    if (run !== refreshVersion || conn !== store.connectionKey.value) return;

    const nextSystems = sortSystems(systemsRes.items ?? [], "severity", true);
    const now = Date.now();
    store.systemsRef.value = nextSystems;
    store.alertsRef.value = alertsRes.items ?? [];
    store.updatedAtRef.value = now;

    const summary = summarizeFleet(nextSystems);
    store.fleetHistoryRef.value = [
      ...store.fleetHistoryRef.value.slice(-(FLEET_HISTORY_LIMIT - 1)),
      { ts: now, avgCpu: summary.avgCpu, bandwidthBytes: summary.totalBandwidthBytes },
    ];

    alertMonitor.processFleet(
      nextSystems,
      store.threshold.value,
      store.notifyEnabled.value,
      store.lang.value,
    );

    const demand = store.syncOutputs();
    const activeDetailId = store.detailIdRef.value;
    const needsDetail =
      activeDetailId &&
      (!demand.known ||
        demand.panel ||
        (store.widgetMode.value === "system" && demand.widget.families.length > 0));
    if (needsDetail && activeDetailId) {
      void detailLoader.load(activeDetailId, store.historyPeriodRef.value, { silent: true });
    }
    if ($metrix.inbox && inbox.isStale(60_000)) void inbox.refresh();
  } catch (error) {
    if (run !== refreshVersion || conn !== store.connectionKey.value) return;
    const { kind, detail } = classifyApiError(error);
    store.setError(kind, detail);
  } finally {
    if (run === refreshVersion) store.refreshingRef.value = false;
  }
}

const actions: PanelActions = {
  onRefresh: () => void refresh(),
  onOpenBeszel: (systemId?: string) => {
    const server = store.serverUrl.value;
    if (server) openHostUrl(systemId ? `${server}/system/${encodeURIComponent(systemId)}` : server);
  },
  onSetView: (view) => {
    store.activeViewRef.value = view;
    if (view === "alerts" && inbox.isStale(15_000)) void inbox.refresh();
  },
  onToggleLayout: () => {
    store.layoutOverrideRef.value = store.currentLayout.value === "cards" ? "table" : "cards";
  },
  onSetSort: (next) => {
    if (store.sortKeyRef.value === next && next !== "severity") {
      store.sortDescRef.value = !store.sortDescRef.value;
    } else {
      store.sortKeyRef.value = next;
      store.sortDescRef.value = next !== "name";
    }
  },
  onSetSearch: (query) => {
    store.searchQueryRef.value = query;
  },
  onOpenDetail: openDetail,
  onCloseDetail: () => {
    detailLoader.cancel();
    store.detailIdRef.value = null;
    store.detailRef.value = null;
  },
  onSetMetric: (metric) => {
    store.historyMetricRef.value = metric;
  },
  onSetPeriod: (period) => {
    if (store.historyPeriodRef.value === period) return;
    store.historyPeriodRef.value = period;
    if (store.detailIdRef.value) void detailLoader.open(store.detailIdRef.value, period);
  },
  onCopySummary: (system) => {
    const detail = store.detailRef.value?.id === system.id ? store.detailRef.value : null;
    const key = `sys:${system.id}`;
    void copyToClipboard(buildSystemSummaryText(system, detail, store.lang.value)).then((ok) => {
      if (!ok) return;
      store.copiedKeyRef.value = key;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        if (store.copiedKeyRef.value === key) store.copiedKeyRef.value = "";
      }, 1800);
    });
  },
  onRefreshInbox: () => void inbox.refresh(),
  onToggleInboxExpand: (item) => {
    const opening = store.expandedInboxKeyRef.value !== item.key;
    store.expandedInboxKeyRef.value = opening ? item.key : null;
    if (opening) {
      store.markInboxRead(item.key);
      void inbox.loadBody(item);
    }
  },
  onDeleteInbox: (item) => void inbox.remove(item),
};

const panelView = computed(() => renderPanel(store.panelState.value, actions));
const surfaceContext = computed<SurfaceContext>(() => ({
  ...store.surfaceData.value,
  onRefresh: actions.onRefresh,
  onOpenBeszel: () => actions.onOpenBeszel(),
  onOpenSystem: (id) => openFromSurface({ systemId: id }),
}));
const trayView = computed(() => buildTray(surfaceContext.value));
const notchView = computed(() => buildNotch(surfaceContext.value, store.demandRef.value.notch));
const widgetViews = computed(() => {
  const d = store.demandRef.value;
  return buildWidgets(surfaceContext.value, d.widget.known && d.widget.families.length === 0);
});

function connectReactiveOutputs(): void {
  if (reactiveWired) return;
  reactiveWired = true;
  store.watchInvalidation(invalidateHost);
}

export async function scheduled(env: Env): Promise<void> {
  store.syncEnv(env);
  store.syncOutputs();
  connectReactiveOutputs();
  scheduleHost(store.refreshIntervalMs.value);
  if (!capsProbed) {
    await store.syncCapabilities("all");
    capsProbed = true;
  }
  await refresh();
}

export function render(env: Env): View {
  store.syncEnv(env);
  const demand = store.syncOutputs();
  connectReactiveOutputs();

  const view: View = { panel: panelView.value };
  if (!demand.known || demand.tray) view.tray = trayView.value;
  const widgets = widgetViews.value;
  if (widgets) view.widget = widgets;
  if (demand.notch) {
    const notch = notchView.value;
    if (notch) view.notch = notch;
  }
  return view;
}

export function event(
  name: string,
  payload?: { type?: string; online?: boolean; tag?: string; id?: string; inboxIds?: string[] },
): void {
  connectReactiveOutputs();
  if (name === "lifecycle" && payload?.type === "expand") {
    if (Date.now() - store.updatedAtRef.value > Math.max(20_000, store.refreshIntervalMs.value)) {
      void refresh();
    }
    return;
  }
  if (name === "outputs") {
    const demand = store.syncOutputs();
    void store.syncCapabilities("all").then((caps) => {
      capsProbed = true;
      if (caps.inboxBoxes && inbox.isStale(60_000)) void inbox.refresh();
    });
    if (
      (demand.panel || demand.notch === "expanded") &&
      store.configured.value &&
      !store.refreshingRef.value &&
      Date.now() - store.updatedAtRef.value > 20_000
    ) {
      void refresh();
    }
    return;
  }
  if (name === "subscription") {
    store.syncSubscription();
    void store.syncCapabilities("all").then((caps) => {
      capsProbed = true;
      if (caps.inboxBoxes) void inbox.refresh();
    });
    return;
  }
  if (name === "system" && payload) {
    if (payload.type === "network.change") {
      const wasOffline = !networkOnline;
      networkOnline = payload.online !== false;
      if (
        networkOnline &&
        store.configured.value &&
        (wasOffline || Date.now() - store.updatedAtRef.value > 10_000)
      ) {
        void refresh();
      }
      return;
    }
    if (payload.type === "notification.click") {
      handleNotificationTag(payload.tag || payload.id || "");
    }
    return;
  }
  if (name === "inboxchange") {
    void inbox.refresh(Array.isArray(payload?.inboxIds) ? payload.inboxIds : undefined);
  }
}

export default { scheduled, render, event };
