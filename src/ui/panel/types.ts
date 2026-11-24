import type {
  AttentionItem,
  Detail,
  ErrorKind,
  FleetSample,
  FleetSummary,
  MetricTab,
  PeriodKey,
  SortKey,
  SystemRecord,
} from "../../beszel/types.ts";
import type { Lang } from "../../host/bridge.ts";
import type { InboxAlert } from "../../inbox/parser.ts";
import type { InboxItemOp } from "../../inbox/service.ts";
import type { PanelScreen } from "../../store.ts";

export const FLYOUT_WIDTH = 460;
export const FLYOUT_HEIGHT = 540;

export interface PanelState {
  lang: Lang;
  screen: PanelScreen;
  viewportWidth: number;
  viewportHeight: number;
  isWide: boolean;
  currentLayout: "cards" | "table";
  configured: boolean;
  serverUrl: string;
  systems: SystemRecord[];
  sortedSystems: SystemRecord[];
  fleetSummary: FleetSummary;
  attentionItems: AttentionItem[];
  fleetHistory: FleetSample[];
  updatedAt: number;
  stale: boolean;
  isInitialLoading: boolean;
  refreshing: boolean;
  errorKind: ErrorKind;
  errorMessage: string;
  errorDetail: string;
  sortKey: SortKey;
  sortDesc: boolean;
  searchQuery: string;
  selectedSystem: SystemRecord | null;
  detail: Detail | null;
  detailLoading: boolean;
  historyMetric: MetricTab;
  historyPeriod: PeriodKey;
  copiedKey: string;
  inboxBoundCount: number;
  inboxAlerts: InboxAlert[];
  inboxUnreadKeys: ReadonlySet<string>;
  expandedInboxKey: string | null;
  inboxBusy: Readonly<Record<string, InboxItemOp>>;
  canInboxRemove: boolean;
}

export interface PanelActions {
  onRefresh: () => void;
  onOpenBeszel: (systemId?: string) => void;
  onSetView: (view: "systems" | "alerts") => void;
  onToggleLayout: () => void;
  onSetSort: (key: SortKey) => void;
  onSetSearch: (query: string) => void;
  onOpenDetail: (id: string) => void;
  onCloseDetail: () => void;
  onSetMetric: (metric: MetricTab) => void;
  onSetPeriod: (period: PeriodKey) => void;
  onCopySummary: (system: SystemRecord) => void;
  onRefreshInbox: () => void;
  onToggleInboxExpand: (alert: InboxAlert) => void;
  onDeleteInbox: (alert: InboxAlert) => void;
}
