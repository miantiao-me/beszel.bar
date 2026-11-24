import { computed, effectScope, ref, shallowRef, watch } from "vue";
import { originOf } from "./beszel/client.ts";
import { buildAttention, sortSystems, summarizeFleet } from "./beszel/metrics.ts";
import type {
  AlertRecord,
  Detail,
  ErrorKind,
  FleetSample,
  MetricTab,
  NotchMetric,
  PeriodKey,
  SortKey,
  SystemRecord,
  TrayFormat,
  WidgetMode,
} from "./beszel/types.ts";
import { buildFleetVerdict, formatErrorMessage } from "./domain/verdict.ts";
import {
  DEFAULT_CAPS,
  DEFAULT_DEMAND,
  isPlusHost,
  langOf,
  probeCapabilities,
  readOutputDemand,
  readSecret,
  readStorage,
  writeStorage,
  type Capabilities,
  type Env,
  type Lang,
  type OutputDemand,
} from "./host/bridge.ts";
import type { InboxAlert } from "./inbox/parser.ts";
import type { InboxItemOp } from "./inbox/service.ts";
import type { PanelState } from "./ui/panel/types.ts";
import type { SurfaceData } from "./ui/surfaces/types.ts";

export type PanelScreen =
  | { kind: "setup" }
  | { kind: "error" }
  | { kind: "alerts" }
  | { kind: "detail"; system: SystemRecord }
  | { kind: "fleet" };

export const STALE_MS = 120_000;
const LAYOUT_KEY = "beszel.layout.v1";
const INBOX_READ_KEY = "beszel.inbox.read.v1";
const WIDE_BREAKPOINT = 840;

const TRAY_FORMATS = new Set<TrayFormat>([
  "online",
  "online_rate",
  "cpu",
  "rate_spark",
  "cpu_spark",
]);
const NOTCH_METRICS = new Set<NotchMetric>(["online", "cpu", "rate"]);
const WIDGET_MODES = new Set<WidgetMode>(["overview", "system", "alerts"]);

function enumInput<T extends string>(value: unknown, allowed: ReadonlySet<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : fallback;
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function createBeszelStore(onConnectionReset: () => void) {
  const envRef = shallowRef<Env>({ inputs: {} });
  const credentialsRef = shallowRef({ email: "", password: "" });
  const demandRef = shallowRef<OutputDemand>(DEFAULT_DEMAND);
  const capsRef = shallowRef<Capabilities>({ ...DEFAULT_CAPS });
  const isPlusRef = ref(false);

  const systemsRef = shallowRef<SystemRecord[]>([]);
  const alertsRef = shallowRef<AlertRecord[]>([]);
  const fleetHistoryRef = shallowRef<FleetSample[]>([]);
  const updatedAtRef = ref(0);
  const refreshingRef = ref(false);
  const errorKindRef = ref<ErrorKind>("");
  const errorDetailRef = ref("");

  const activeViewRef = ref<"systems" | "alerts">("systems");
  const layoutOverrideRef = ref<"cards" | "table" | null>(null);
  const sortKeyRef = ref<SortKey>("severity");
  const sortDescRef = ref(true);
  const searchQueryRef = ref("");

  const detailIdRef = ref<string | null>(null);
  const detailRef = shallowRef<Detail | null>(null);
  const detailLoadingRef = ref(false);
  const historyMetricRef = ref<MetricTab>("CPU");
  const historyPeriodRef = ref<PeriodKey>("1h");
  const copiedKeyRef = ref("");

  const inboxBoundCountRef = ref(0);
  const inboxAlertsRef = shallowRef<InboxAlert[]>([]);
  const inboxReadKeysRef = shallowRef<Set<string>>(new Set());
  const expandedInboxKeyRef = ref<string | null>(null);
  const inboxBusyRef = shallowRef<Record<string, InboxItemOp>>({});
  const activeNotchActivityRef = shallowRef<{ id: string; expiresAt: number } | null>(null);

  // ---- Computed derivations --------------------------------------------
  const lang = computed<Lang>(() => langOf(envRef.value));
  const serverUrl = computed(() => {
    const value = envRef.value.inputs.server;
    return typeof value === "string" && value.trim() ? originOf(value) : "";
  });
  const configured = computed(() =>
    Boolean(serverUrl.value && credentialsRef.value.email && credentialsRef.value.password),
  );
  const connectionKey = computed(
    () => `${serverUrl.value}|${credentialsRef.value.email}|${credentialsRef.value.password}`,
  );
  const refreshIntervalMs = computed(() => {
    const raw = Number(envRef.value.inputs.refreshInterval ?? 30);
    return (Number.isFinite(raw) && raw >= 15 && raw <= 300 ? raw : 30) * 1000;
  });
  const threshold = computed(() => {
    const value = Number(envRef.value.inputs.threshold ?? 90);
    return Number.isFinite(value) && value > 0 ? Math.min(100, value) : 0;
  });
  const trayFormat = computed(() =>
    enumInput(envRef.value.inputs.trayFormat, TRAY_FORMATS, "online"),
  );
  const notchMetric = computed(() =>
    enumInput(envRef.value.inputs.notchMetric, NOTCH_METRICS, "online"),
  );
  const widgetMode = computed(() =>
    enumInput(envRef.value.inputs.widgetMode, WIDGET_MODES, "overview"),
  );
  const widgetSystem = computed(() =>
    typeof envRef.value.inputs.widgetSystem === "string"
      ? envRef.value.inputs.widgetSystem.trim()
      : "",
  );
  const notifyEnabled = computed(() => envRef.value.inputs.notify === true);

  const isWide = computed(() => (envRef.value.viewport?.width ?? 0) >= WIDE_BREAKPOINT);
  const currentLayout = computed<"cards" | "table">(
    () => layoutOverrideRef.value ?? (isWide.value ? "table" : "cards"),
  );
  const isInitialLoading = computed(() => refreshingRef.value && updatedAtRef.value === 0);
  const stale = computed(
    () => updatedAtRef.value > 0 && Date.now() - updatedAtRef.value > STALE_MS,
  );
  const friendlyError = computed(() =>
    formatErrorMessage(errorKindRef.value, errorDetailRef.value, lang.value),
  );
  const fleetSummary = computed(() => summarizeFleet(systemsRef.value));

  const sortedSystems = computed(() => {
    const q = searchQueryRef.value.trim().toLowerCase();
    const base = q
      ? systemsRef.value.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.host && s.host.toLowerCase().includes(q)) ||
            (s.info?.h && s.info.h.toLowerCase().includes(q)),
        )
      : systemsRef.value;
    return sortSystems(base, sortKeyRef.value, sortDescRef.value);
  });

  const attentionItems = computed(() =>
    buildAttention(systemsRef.value, alertsRef.value, threshold.value, lang.value),
  );
  const unreadInboxKeys = computed(
    () =>
      new Set(
        inboxAlertsRef.value.filter((a) => !inboxReadKeysRef.value.has(a.key)).map((a) => a.key),
      ),
  );
  const selectedSystem = computed<SystemRecord | null>(() => {
    const id = detailIdRef.value;
    if (id) {
      const found = systemsRef.value.find((s) => s.id === id);
      if (found) return found;
    }
    return isWide.value ? (sortedSystems.value[0] ?? null) : null;
  });

  /** Explicit panel screen state machine replacing implicit boolean combinations. */
  const screen = computed<PanelScreen>(() => {
    if (!configured.value) return { kind: "setup" };
    if (errorKindRef.value && systemsRef.value.length === 0) return { kind: "error" };
    if (!isWide.value && detailIdRef.value && selectedSystem.value) {
      return { kind: "detail", system: selectedSystem.value };
    }
    if (activeViewRef.value === "alerts") return { kind: "alerts" };
    return { kind: "fleet" };
  });

  const verdict = computed(() =>
    buildFleetVerdict({
      systems: systemsRef.value,
      summary: fleetSummary.value,
      threshold: threshold.value,
      errorKind: errorKindRef.value,
      errorMessage: friendlyError.value,
      isInitialLoading: isInitialLoading.value,
      stale: stale.value,
      updatedAt: updatedAtRef.value,
      lang: lang.value,
    }),
  );

  const panelState = computed<PanelState>(() => ({
    lang: lang.value,
    screen: screen.value,
    viewportWidth: envRef.value.viewport?.width ?? 0,
    viewportHeight: envRef.value.viewport?.height ?? 0,
    isWide: isWide.value,
    currentLayout: currentLayout.value,
    configured: configured.value,
    serverUrl: serverUrl.value,
    systems: systemsRef.value,
    sortedSystems: sortedSystems.value,
    fleetSummary: fleetSummary.value,
    attentionItems: attentionItems.value,
    fleetHistory: fleetHistoryRef.value,
    updatedAt: updatedAtRef.value,
    stale: stale.value,
    isInitialLoading: isInitialLoading.value,
    refreshing: refreshingRef.value,
    errorKind: errorKindRef.value,
    errorMessage: friendlyError.value,
    errorDetail: errorDetailRef.value,
    sortKey: sortKeyRef.value,
    sortDesc: sortDescRef.value,
    searchQuery: searchQueryRef.value,
    selectedSystem: selectedSystem.value,
    detail: detailRef.value,
    detailLoading: detailLoadingRef.value,
    historyMetric: historyMetricRef.value,
    historyPeriod: historyPeriodRef.value,
    copiedKey: copiedKeyRef.value,
    inboxBoundCount: inboxBoundCountRef.value,
    inboxAlerts: inboxAlertsRef.value,
    inboxUnreadKeys: unreadInboxKeys.value,
    expandedInboxKey: expandedInboxKeyRef.value,
    inboxBusy: inboxBusyRef.value,
    canInboxRemove: capsRef.value.inboxRemove,
  }));

  const surfaceData = computed<SurfaceData>(() => ({
    lang: lang.value,
    configured: configured.value,
    serverUrl: serverUrl.value,
    systems: systemsRef.value,
    fleetSummary: fleetSummary.value,
    attentionItems: attentionItems.value,
    fleetHistory: fleetHistoryRef.value,
    inboxAlerts: inboxAlertsRef.value,
    inboxUnreadKeys: unreadInboxKeys.value,
    stale: stale.value,
    errorKind: errorKindRef.value,
    errorMessage: friendlyError.value,
    verdictText: verdict.value.text,
    verdictTone: verdict.value.tone ?? "muted",
    trayFormat: trayFormat.value,
    notchMetric: notchMetric.value,
    activeNotchActivity: activeNotchActivityRef.value,
    widgetMode: widgetMode.value,
    widgetSystem: widgetSystem.value,
    selectedSystemId: detailIdRef.value,
    detail: widgetMode.value === "system" ? detailRef.value : null,
    caps: capsRef.value,
  }));

  // ---- Hydration & host sync -------------------------------------------
  let hydrated = false;
  let lastConnKey = "";
  const scope = effectScope(true);

  function hydrateOnce(): void {
    if (hydrated) return;
    hydrated = true;
    const savedLayout = readStorage<string | null>(LAYOUT_KEY, null);
    layoutOverrideRef.value =
      savedLayout === "cards" || savedLayout === "table" ? savedLayout : null;
    const savedReads = readStorage<unknown>(INBOX_READ_KEY, []);
    inboxReadKeysRef.value = new Set(Array.isArray(savedReads) ? savedReads.map(String) : []);

    scope.run(() => {
      watch(
        connectionKey,
        (next) => {
          if (lastConnKey && lastConnKey !== next) {
            systemsRef.value = [];
            alertsRef.value = [];
            fleetHistoryRef.value = [];
            updatedAtRef.value = 0;
            detailIdRef.value = null;
            detailRef.value = null;
            detailLoadingRef.value = false;
            activeViewRef.value = "systems";
            searchQueryRef.value = "";
            activeNotchActivityRef.value = null;
            errorKindRef.value = "";
            errorDetailRef.value = "";
            onConnectionReset();
          }
          lastConnKey = next;
        },
        { flush: "sync", immediate: true },
      );

      watch(
        layoutOverrideRef,
        (next) => {
          if (next) writeStorage(LAYOUT_KEY, next);
        },
        { flush: "sync" },
      );
      watch(
        inboxReadKeysRef,
        (next) => {
          writeStorage(INBOX_READ_KEY, [...next].slice(-200));
        },
        { flush: "sync" },
      );
    });
  }

  // Synchronous invalidation bypasses Vue's async flushJobs queue, which moejs loop interrupts can otherwise stall.
  function watchInvalidation(onInvalidate: () => void): void {
    scope.run(() => {
      watch(
        [
          systemsRef,
          alertsRef,
          fleetHistoryRef,
          updatedAtRef,
          errorKindRef,
          errorDetailRef,
          inboxAlertsRef,
          inboxReadKeysRef,
          activeNotchActivityRef,
          capsRef,
          activeViewRef,
          layoutOverrideRef,
          sortKeyRef,
          sortDescRef,
          searchQueryRef,
          detailIdRef,
          detailRef,
          detailLoadingRef,
          historyMetricRef,
          historyPeriodRef,
          copiedKeyRef,
          inboxBoundCountRef,
          expandedInboxKeyRef,
          inboxBusyRef,
          refreshingRef,
        ],
        () => onInvalidate(),
        { flush: "sync" },
      );
    });
  }

  function setError(kind: ErrorKind, detail = ""): void {
    errorKindRef.value = kind;
    errorDetailRef.value = detail;
  }

  function setInboxItemBusy(key: string, op: InboxItemOp | null): void {
    const prev = inboxBusyRef.value;
    if (op === null) {
      if (!(key in prev)) return;
      const next = { ...prev };
      delete next[key];
      inboxBusyRef.value = next;
    } else if (prev[key] !== op) {
      inboxBusyRef.value = { ...prev, [key]: op };
    }
  }

  function mutateReadKeys(key: string, present: boolean): void {
    if (inboxReadKeysRef.value.has(key) === present) return;
    const next = new Set(inboxReadKeysRef.value);
    if (present) next.add(key);
    else next.delete(key);
    inboxReadKeysRef.value = next;
  }

  function syncOutputs(): OutputDemand {
    const next = readOutputDemand();
    if (!sameValue(demandRef.value, next)) demandRef.value = next;
    return demandRef.value;
  }

  function syncSubscription(): void {
    const plus = isPlusHost();
    if (isPlusRef.value !== plus) isPlusRef.value = plus;
  }

  async function syncCapabilities(scopeMode: "all" | "inbox" = "all"): Promise<Capabilities> {
    const next = await probeCapabilities(capsRef.value, scopeMode);
    if (!sameValue(capsRef.value, next)) capsRef.value = next;
    return capsRef.value;
  }

  function syncEnv(env: Env): void {
    hydrateOnce();
    const prev = envRef.value;
    if (
      !sameValue(prev.inputs, env.inputs) ||
      prev.viewport?.width !== env.viewport?.width ||
      prev.viewport?.height !== env.viewport?.height
    ) {
      envRef.value = env;
    }
    const nextCreds = { email: readSecret("email"), password: readSecret("password") };
    if (!sameValue(credentialsRef.value, nextCreds)) credentialsRef.value = nextCreds;
    syncSubscription();
  }

  return {
    scope,
    credentialsRef,
    demandRef,
    capsRef,
    systemsRef,
    alertsRef,
    fleetHistoryRef,
    updatedAtRef,
    refreshingRef,
    activeViewRef,
    layoutOverrideRef,
    sortKeyRef,
    sortDescRef,
    searchQueryRef,
    detailIdRef,
    detailRef,
    detailLoadingRef,
    historyMetricRef,
    historyPeriodRef,
    copiedKeyRef,
    inboxBoundCountRef,
    inboxAlertsRef,
    inboxReadKeysRef,
    expandedInboxKeyRef,
    inboxBusyRef,
    activeNotchActivityRef,
    lang,
    serverUrl,
    configured,
    connectionKey,
    refreshIntervalMs,
    threshold,
    widgetMode,
    notifyEnabled,
    currentLayout,
    panelState,
    surfaceData,
    setError,
    setInboxItemBusy,
    markInboxRead: (key: string) => mutateReadKeys(key, true),
    deleteInboxReadKey: (key: string) => mutateReadKeys(key, false),
    syncEnv,
    syncOutputs,
    syncSubscription,
    syncCapabilities,
    watchInvalidation,
  };
}
